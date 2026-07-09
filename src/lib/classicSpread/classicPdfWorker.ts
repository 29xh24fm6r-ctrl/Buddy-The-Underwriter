/**
 * SPEC-B3 — Classic Spread PDF Worker.
 *
 * Pre-renders the Classic Spread PDF and caches it as a deal_spreads row.
 * The row IS the cache — one row per (deal_id, bank_id, CLASSIC_PDF).
 * Invalidation is event-driven: the worker overwrites the row when triggered.
 *
 * Uses PDFKit (pure Node) — no Playwright, no browser dependency.
 *
 * Non-negotiable: same render path as the synchronous route. Both call
 * loadClassicSpreadData → preflightClassicSpread → renderClassicSpread.
 */

import "server-only";

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import { renderClassicSpread } from "@/lib/classicSpread/classicSpreadRenderer";
import { generateSpreadNarrative } from "@/lib/classicSpread/narrativeEngine";
import { preflightClassicSpread } from "@/lib/spreads/preflight/spreadPreflight";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { CLASSIC_PDF_RENDER_VERSION } from "@/lib/classicSpread/classicPdfRenderVersion";
import { computeClassicPdfInputsHash } from "@/lib/classicSpread/classicPdfInputsHash";

// ── Constants ─────────────────────────────────────────────────────────────────

const SPREAD_TYPE = "CLASSIC_PDF" as const;
const SPREAD_VERSION = 1;
const OWNER_TYPE = "DEAL";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClassicPdfWorkerResult = {
  ok: true;
  pdfSha256: string;
  pdfSizeBytes: number;
  canonicalFactsTimestamp: string | null;
  /** True when the render was skipped because inputs_hash matched the cached row. */
  unchanged?: boolean;
} | {
  ok: false;
  error: string;
  errorCode: "PREFLIGHT_BLOCKED" | "RENDER_FAILED" | "PERSIST_FAILED";
};

export type ClassicPdfCachedPayload = {
  pdf_base64: string;
  pdf_sha256: string;
  pdf_size_bytes: number;
  canonicalFactsTimestamp: string | null;
  generatedAt: string;
  /** SPEC-SPREAD-SOURCE-OF-TRUTH-UNIFICATION-1: code-version stamp — a mismatch busts the blob. */
  renderVersion?: number;
  /** Tier-8: deterministic content hash of the render-driving inputs (see classicPdfInputsHash). */
  inputsHash?: string;
  /** SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1: pre-render certification audit. */
  certificationAudit?: import("@/lib/classicSpread/certification/certifiedSpreadGateCore").ClassicSpreadCertificationAudit | null;
};

// ── Main worker function ──────────────────────────────────────────────────────

export async function renderClassicPdfSpread(args: {
  dealId: string;
  bankId: string;
}): Promise<ClassicPdfWorkerResult> {
  const { dealId, bankId } = args;
  const sb = supabaseAdmin();

  // 1. Load input data (same path as synchronous route) — bank-scoped (#1).
  const input = await loadClassicSpreadData(dealId, bankId);

  // 2. Preflight gate — if BS or IS rows are empty, don't generate
  const preflight = await preflightClassicSpread({
    dealId,
    bankId,
    balanceSheetRowCount: input.balanceSheet.length,
    incomeStatementRowCount: input.incomeStatement.length,
  });

  if (preflight.status === "blocked") {
    return {
      ok: false,
      error: `Preflight blocked: ${preflight.reason}`,
      errorCode: "PREFLIGHT_BLOCKED",
    };
  }

  // 2b. Tier-8: compute the real content hash of the render inputs (render
  // version folded in). If an existing READY cache already carries this exact
  // hash, the inputs and renderer are unchanged — skip the expensive PDF render
  // and re-persist. This makes inputs_hash the operative invalidation signal:
  // a re-render only materializes when the content or render version differs,
  // rather than blindly re-rendering on every trigger.
  const inputsHash = computeClassicPdfInputsHash(input);
  const canonicalFactsTimestampEarly = await getLatestFactsTimestamp(sb, dealId, bankId);
  const { data: existingRow } = await (sb as any)
    .from("deal_spreads")
    .select("inputs_hash, status, rendered_json")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("spread_type", SPREAD_TYPE)
    .eq("spread_version", SPREAD_VERSION)
    .eq("owner_type", OWNER_TYPE)
    .eq("owner_entity_id", SENTINEL_UUID)
    .maybeSingle();

  if (
    existingRow?.status === "ready" &&
    existingRow?.inputs_hash &&
    existingRow.inputs_hash === inputsHash &&
    existingRow.rendered_json?.pdf_base64
  ) {
    // Content + renderer unchanged. Refresh only the staleness stamp so the
    // timestamp-based ensure/cached routes do not re-enqueue in a loop when a
    // fact's updated_at advanced without any value change. No re-render.
    const cachedStamp = existingRow.rendered_json?.canonicalFactsTimestamp ?? null;
    if (canonicalFactsTimestampEarly && canonicalFactsTimestampEarly !== cachedStamp) {
      await (sb as any)
        .from("deal_spreads")
        .update({
          rendered_json: { ...existingRow.rendered_json, canonicalFactsTimestamp: canonicalFactsTimestampEarly },
          updated_at: new Date().toISOString(),
        })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("spread_type", SPREAD_TYPE)
        .eq("spread_version", SPREAD_VERSION)
        .eq("owner_type", OWNER_TYPE)
        .eq("owner_entity_id", SENTINEL_UUID);
    }
    return {
      ok: true,
      pdfSha256: existingRow.rendered_json?.pdf_sha256 ?? "",
      pdfSizeBytes: existingRow.rendered_json?.pdf_size_bytes ?? 0,
      canonicalFactsTimestamp: canonicalFactsTimestampEarly ?? cachedStamp,
      unchanged: true,
    };
  }

  // 3. Generate narrative (optional — graceful fallback)
  const narrative = await generateSpreadNarrative(input).catch(() => null);

  // 4. Render PDF buffer
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderClassicSpread(input, narrative);
  } catch (err: any) {
    return {
      ok: false,
      error: `Render failed: ${err?.message ?? String(err)}`,
      errorCode: "RENDER_FAILED",
    };
  }

  // 5. Compute SHA-256 for verification
  const pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

  // 6. Latest canonical facts timestamp for staleness comparison (fetched in 2b).
  const canonicalFactsTimestamp = canonicalFactsTimestampEarly;

  // 7. Build the cached payload
  const generatedAt = new Date().toISOString();
  const payload: ClassicPdfCachedPayload = {
    pdf_base64: pdfBuffer.toString("base64"),
    pdf_sha256: pdfSha256,
    pdf_size_bytes: pdfBuffer.length,
    canonicalFactsTimestamp,
    generatedAt,
    renderVersion: CLASSIC_PDF_RENDER_VERSION,
    inputsHash,
    certificationAudit: input.certificationAudit ?? null,
  };

  // 8. Upsert to deal_spreads — the row IS the cache
  const { error: upsertErr } = await (sb as any)
    .from("deal_spreads")
    .upsert(
      {
        deal_id: dealId,
        bank_id: bankId,
        spread_type: SPREAD_TYPE,
        spread_version: SPREAD_VERSION,
        owner_type: OWNER_TYPE,
        owner_entity_id: SENTINEL_UUID,
        status: "ready",
        inputs_hash: inputsHash,
        rendered_json: payload,
        rendered_html: null,
        rendered_csv: null,
        error: null,
        error_code: null,
        finished_at: generatedAt,
        updated_at: generatedAt,
      },
      { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" } as any,
    );

  if (upsertErr) {
    return {
      ok: false,
      error: `Persist failed: ${upsertErr.message}`,
      errorCode: "PERSIST_FAILED",
    };
  }

  return {
    ok: true,
    pdfSha256,
    pdfSizeBytes: pdfBuffer.length,
    canonicalFactsTimestamp,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getLatestFactsTimestamp(
  sb: any,
  dealId: string,
  bankId: string,
): Promise<string | null> {
  try {
    const { data } = await sb
      .from("deal_financial_facts")
      .select("updated_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.updated_at ?? null;
  } catch {
    return null;
  }
}
