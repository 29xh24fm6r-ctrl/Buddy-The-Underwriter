/**
 * runNamingDerivation — SINGLE ENTRY POINT for naming derivation.
 *
 * Call sites:
 *   - after artifact classification write  (processArtifact)
 *   - after artifact extraction write
 *   - (optional) after checklist reconcile
 *
 * Hard guards:
 *   - Deal must exist (else ledger event + bail)
 *   - DB-backed throttle: max once per deal per 30 s  (serverless-safe)
 *   - Fully idempotent
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyDocumentDerivedNaming } from "./applyDocumentDerivedNaming";
import { applyDealDerivedNaming } from "./applyDealDerivedNaming";
import { writeEvent } from "@/lib/ledger/writeEvent";

const THROTTLE_SECONDS = 30;

// ─── Types ──────────────────────────────────────────────────────────────────

export type RunNamingDerivationResult = {
  ok: boolean;
  throttled: boolean;
  dealNaming?: {
    changed: boolean;
    dealName: string | null;
  };
  documentNaming?: Array<{
    documentId: string;
    changed: boolean;
    displayName: string | null;
  }>;
  error?: string;
};

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runNamingDerivation(opts: {
  dealId: string;
  bankId: string;
  /** If provided, only derive for this document (+ deal). Otherwise all documents. */
  documentId?: string;
}): Promise<RunNamingDerivationResult> {
  const { dealId, bankId, documentId } = opts;
  const sb = supabaseAdmin();

  // ── 1. Read deal + check throttle ─────────────────────────────────────────
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, last_naming_derivation_at")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    await writeEvent({
      dealId,
      kind: "deal.name.derived",
      meta: {
        status: "blocked",
        fallback_reason: "blocked_deal_access",
        error: dealErr?.message ?? "deal_not_found",
      },
    });
    return { ok: false, throttled: false, error: "deal_not_found" };
  }

  // ── 2. DB-backed throttle: skip if last run < 30 s ago ────────────────────
  const lastAt = (deal as any).last_naming_derivation_at;
  if (lastAt) {
    const elapsed = Date.now() - new Date(lastAt).getTime();
    if (elapsed < THROTTLE_SECONDS * 1000) {
      return { ok: true, throttled: true };
    }
  }

  // ── 3. Stamp throttle BEFORE running (prevents stampede) ──────────────────
  await sb
    .from("deals")
    .update({ last_naming_derivation_at: new Date().toISOString() } as any)
    .eq("id", dealId);

  // ── 4. Document naming ────────────────────────────────────────────────────
  const docResults: RunNamingDerivationResult["documentNaming"] = [];

  if (documentId) {
    // Single document mode
    const r = await applyDocumentDerivedNaming({ documentId, dealId, bankId });
    docResults.push({
      documentId,
      changed: r.changed,
      displayName: r.displayName,
    });
  } else {
    // All documents for this deal
    const { data: docs } = await sb
      .from("deal_documents")
      .select("id")
      .eq("deal_id", dealId);

    if (docs) {
      for (const doc of docs) {
        const r = await applyDocumentDerivedNaming({
          documentId: doc.id,
          dealId,
          bankId,
        });
        docResults.push({
          documentId: doc.id,
          changed: r.changed,
          displayName: r.displayName,
        });
      }
    }
  }

  // ── 5. Deal naming ────────────────────────────────────────────────────────
  const dealResult = await applyDealDerivedNaming({ dealId, bankId });

  return {
    ok: true,
    throttled: false,
    dealNaming: {
      changed: dealResult.changed,
      dealName: dealResult.dealName,
    },
    documentNaming: docResults,
  };
}
