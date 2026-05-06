import "server-only";

// Reprocess umbrella dispatcher.
//
// Consolidates four prior sibling routes that all "rerun part of the
// document pipeline" into a single endpoint to reduce Vercel route-manifest
// pressure (post-2026-05-06 too_many_routes incident — the project is
// pinned near the 2048 deploy-route cap; see
// specs/platform/SPEC-2026-05-vercel-route-count-reduction.md).
//
// Wire shape:
//   POST /reprocess  body: { scope: "single-doc" }       (was /re-extract)
//   POST /reprocess  body: { scope: "extract-all" }      (was /reextract-all)
//   POST /reprocess  body: { scope: "reclassify-all" }   (was /reclassify-all)
//   POST /reprocess  body: { scope: "documents" }        (was /reprocess-documents — admin)
//
//   GET  /reprocess?scope=extract-all                    (was GET /reextract-all preflight)
//   GET  /reprocess?scope=reclassify-all                 (was GET /reclassify-all preflight)
//
// Auth is per-scope, NOT per-verb. Each scope retains the exact auth path
// its predecessor used:
//   - scope=single-doc      → clerkAuth + ensureDealBankAccess
//   - scope=extract-all     → clerkAuth + ensureDealBankAccess
//   - scope=reclassify-all  → ensureDealBankAccess          (uses access.userId)
//   - scope=documents       → requireDealCockpitAccess + COCKPIT_ROLES (admin-only)
// The admin-only branch MUST keep its stricter guard. Do not collapse the
// auth checks — the scope dispatch is the entire point of preserving them.
//
// Response envelopes are byte-identical with the prior routes; field names
// differ across scopes (documents_processed vs reprocessed, etc.) — this
// is intentional and matches existing client expectations.
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  requireDealCockpitAccess,
  COCKPIT_ROLES,
} from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";
import { queueDocExtractionOutbox } from "@/lib/intake/processing/queueDocExtractionOutbox";
import { runGatekeeperForDocument } from "@/lib/gatekeeper/runGatekeeper";
import { getGeminiPromptVersion } from "@/lib/gatekeeper/geminiClassifier";
import {
  classifyAllDocs,
  type ClassifyLoopDoc,
} from "@/lib/gatekeeper/classifyAllDocs";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { clerkAuth } from "@/lib/auth/clerkServer";
import type { SpreadType } from "@/lib/financialSpreads/types";
import { spreadsForDocType } from "@/lib/financialSpreads/docTypeToSpreadTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ dealId: string }> };

// ── POST dispatcher ─────────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { scope?: string };
    const scope = typeof body.scope === "string" ? body.scope : "";

    if (scope === "single-doc") return handleSingleDoc(dealId);
    if (scope === "extract-all") return handleExtractAll(dealId);
    if (scope === "reclassify-all") return handleReclassifyAll(dealId);
    if (scope === "documents") return handleDocumentsAdmin(dealId);

    return NextResponse.json(
      { ok: false, error: `unknown scope: ${scope || "(missing)"}` },
      { status: 400 },
    );
  } catch (error: any) {
    rethrowNextErrors(error);
    console.error("[reprocess POST]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}

// ── GET dispatcher (preflight summaries) ────────────────────────────────

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") ?? "";

    if (scope === "extract-all") return handleExtractAllPreflight(dealId);
    if (scope === "reclassify-all") return handleReclassifyAllPreflight(dealId);

    return NextResponse.json(
      { ok: false, error: `unknown scope: ${scope || "(missing)"}` },
      { status: 400 },
    );
  } catch (error: any) {
    rethrowNextErrors(error);
    console.error("[reprocess GET]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}

// ── scope=single-doc — was POST /re-extract ─────────────────────────────
// Re-runs fact extraction + spread rendering for all classified documents
// in a deal. Reads document types from deal_documents (the authoritative
// source stamped by processArtifact or manual UI classification).

async function handleSingleDoc(dealId: string) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "deal_not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const sb = supabaseAdmin();

  // Read from deal_documents — the authoritative source for doc types.
  // processArtifact stamps document_type here; manual classification sets it too.
  const { data: docs } = await sb
    .from("deal_documents" as any)
    .select("id, document_type, ai_doc_type, canonical_type, original_filename")
    .eq("deal_id", dealId)
    .not("document_type", "is", null);

  if (!docs || docs.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No classified documents to re-extract",
      documents_processed: 0,
      total_facts_written: 0,
    });
  }

  let totalFacts = 0;
  let processed = 0;
  const spreadTypesNeeded = new Set<SpreadType>();
  const errors: string[] = [];

  for (const doc of docs as any[]) {
    try {
      const docType = doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type;
      const result = await extractFactsFromDocument({
        dealId,
        bankId: access.bankId,
        documentId: doc.id,
        docTypeHint: docType,
      });
      totalFacts += result.factsWritten;
      processed++;

      // Collect spread types needed
      for (const st of spreadsForDocType(docType)) {
        spreadTypesNeeded.add(st);
      }
    } catch (err: any) {
      errors.push(`${doc.id}: ${err?.message ?? "unknown"}`);
    }
  }

  // STANDARD (Financial Analysis) is always needed — it's an aggregate spread
  if (processed > 0) spreadTypesNeeded.add("STANDARD");

  // E2: Trigger spread orchestration after re-extraction
  let orchestrateResult: any = null;
  try {
    const { orchestrateSpreads } = await import(
      "@/lib/spreads/orchestrateSpreads"
    );
    orchestrateResult = await orchestrateSpreads(
      dealId,
      access.bankId,
      "recompute",
      userId,
    );
  } catch (orchErr: any) {
    errors.push(`orchestrate: ${orchErr?.message ?? "unknown"}`);
  }

  await logLedgerEvent({
    dealId,
    bankId: access.bankId,
    eventKey: "deal.re_extract",
    uiState: "working",
    uiMessage: `Re-extracted facts from ${processed} documents (${totalFacts} facts), orchestrated spreads`,
    meta: {
      triggered_by: userId,
      documents_processed: processed,
      total_facts_written: totalFacts,
      spread_types: Array.from(spreadTypesNeeded),
      orchestrate: orchestrateResult,
      errors: errors.length > 0 ? errors : undefined,
    },
  });

  return NextResponse.json({
    ok: true,
    documents_processed: processed,
    total_facts_written: totalFacts,
    spread_types_enqueued: Array.from(spreadTypesNeeded),
    orchestrate: orchestrateResult,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ── scope=extract-all — was POST /reextract-all ─────────────────────────
// Bulk re-extraction: queues every classified document in the deal for
// async re-extraction via the doc.extract outbox with forceRefresh=true.

async function handleExtractAll(dealId: string) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "deal_not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const sb = supabaseAdmin();

  const { data: docs, error: docErr } = await sb
    .from("deal_documents" as any)
    .select("id, document_type, ai_doc_type, canonical_type, original_filename")
    .eq("deal_id", dealId)
    .not("document_type", "is", null);

  if (docErr) {
    return NextResponse.json(
      { ok: false, error: `doc_load_failed: ${docErr.message}` },
      { status: 500 },
    );
  }

  const allDocs = (docs ?? []) as any[];
  if (allDocs.length === 0) {
    return NextResponse.json({
      ok: true,
      queued: 0,
      message: "No classified documents to re-extract",
    });
  }

  let queued = 0;
  const errors: string[] = [];

  for (const doc of allDocs) {
    try {
      const docType =
        doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type;

      await queueDocExtractionOutbox({
        dealId,
        bankId: access.bankId,
        docId: doc.id,
        docType,
        forceRefresh: true,
      });

      queued++;
    } catch (err: any) {
      errors.push(`${doc.id}: ${err?.message ?? "unknown"}`);
    }
  }

  await logLedgerEvent({
    dealId,
    bankId: access.bankId,
    eventKey: "reextraction.batch.queued",
    uiState: "working",
    uiMessage: `Queued ${queued} documents for re-extraction (dedup bypass enabled)`,
    meta: {
      triggered_by: userId,
      queued,
      total_docs: allDocs.length,
      force_refresh: true,
      errors: errors.length > 0 ? errors : undefined,
    },
  });

  return NextResponse.json({
    ok: true,
    queued,
    message: `${queued} documents queued for re-extraction. Results will appear as each document completes.`,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ── scope=extract-all (GET) — preflight summary ─────────────────────────
// Was GET /reextract-all. Reports eligible doc count, type breakdown, last
// extraction timestamp, and whether a new prompt version exists.

async function handleExtractAllPreflight(dealId: string) {
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "deal_not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const sb = supabaseAdmin();

  const { data: docs, error: docErr } = await sb
    .from("deal_documents" as any)
    .select("id, document_type, canonical_type, ai_doc_type, created_at")
    .eq("deal_id", dealId)
    .not("document_type", "is", null);

  if (docErr) {
    return NextResponse.json(
      { ok: false, error: `doc_load_failed: ${docErr.message}` },
      { status: 500 },
    );
  }

  const classified = (docs ?? []) as any[];

  const documentsByType: Record<string, number> = {};
  for (const doc of classified) {
    const docType =
      doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type;
    documentsByType[docType] = (documentsByType[docType] ?? 0) + 1;
  }

  const { data: latestFact } = await sb
    .from("deal_financial_facts" as any)
    .select("updated_at")
    .eq("deal_id", dealId)
    .eq("bank_id", access.bankId)
    .order("updated_at", { ascending: false })
    .limit(1);

  const lastExtractionAt = (latestFact as any)?.[0]?.updated_at ?? null;

  // Proxy for "has new prompt version": any classified doc created after
  // the last extraction (or last extraction older than cutoff date).
  // Cutoff: 2026-03-07 — represents latest prompt/extractor revision.
  const PROMPT_VERSION_CUTOFF = "2026-03-07T00:00:00Z";
  const hasNewPromptVersion = lastExtractionAt
    ? new Date(lastExtractionAt) < new Date(PROMPT_VERSION_CUTOFF)
    : classified.length > 0;

  return NextResponse.json({
    ok: true,
    eligibleDocuments: classified.length,
    documentsByType,
    lastExtractionAt,
    hasNewPromptVersion,
  });
}

// ── scope=reclassify-all — was POST /reclassify-all ─────────────────────
// Force-reruns the Gemini gatekeeper classifier on every document of a deal.
// Used when the classifier prompt changes (Spec D1: entity-name extraction
// added in v2) or when a banker needs to bulk-correct misclassifications.

async function handleReclassifyAll(dealId: string) {
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "deal_not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const sb = supabaseAdmin();

  const { data: docs, error: docErr } = await (sb as any)
    .from("deal_documents")
    .select(
      "id, deal_id, bank_id, sha256, storage_bucket, storage_path, mime_type, original_filename",
    )
    .eq("deal_id", dealId)
    .eq("bank_id", access.bankId)
    .not("storage_path", "is", null);

  if (docErr) {
    return NextResponse.json(
      { ok: false, error: `doc_load_failed: ${docErr.message}` },
      { status: 500 },
    );
  }

  if (!docs || docs.length === 0) {
    return NextResponse.json({
      ok: true,
      total: 0,
      reclassified: 0,
      failed: 0,
      message: "No documents to reclassify",
    });
  }

  // OCR text lives on document_ocr_results.extracted_text (linked via
  // attachment_id = deal_documents.id), not on deal_documents itself.
  const docIds = (docs as Array<{ id: string }>).map((d) => d.id);
  const { data: ocrRows } = await (sb as any)
    .from("document_ocr_results")
    .select("attachment_id, extracted_text")
    .in("attachment_id", docIds);
  const ocrByDocId = new Map<string, string>();
  for (const row of (ocrRows ?? []) as Array<{
    attachment_id: string;
    extracted_text: string | null;
  }>) {
    if (row.extracted_text) ocrByDocId.set(row.attachment_id, row.extracted_text);
  }

  const loopSummary = await classifyAllDocs(
    docs as ClassifyLoopDoc[],
    (doc) =>
      runGatekeeperForDocument({
        documentId: doc.id,
        dealId: doc.deal_id,
        bankId: doc.bank_id,
        sha256: doc.sha256 ?? null,
        ocrText: ocrByDocId.get(doc.id) ?? null,
        storageBucket: doc.storage_bucket,
        storagePath: doc.storage_path,
        mimeType: doc.mime_type,
        forceReclassify: true,
      }),
  );
  const { reclassified, failed, results, errors } = loopSummary;

  // Fire naming derivation so new entity names reach deals.display_name.
  try {
    const { maybeTriggerDealNaming } = await import(
      "@/lib/naming/maybeTriggerDealNaming"
    );
    await maybeTriggerDealNaming(dealId, {
      bankId: access.bankId,
      reason: "reclassify_all_completed",
    });
  } catch (namingErr) {
    console.warn("[reclassify-all] naming trigger failed (non-fatal)", {
      dealId,
      error: namingErr instanceof Error ? namingErr.message : "unknown",
    });
  }

  await logLedgerEvent({
    dealId,
    bankId: access.bankId,
    eventKey: "deal.reclassify_all",
    uiState: failed > 0 ? "error" : "done",
    uiMessage: `Reclassified ${reclassified}/${docs.length} documents${failed > 0 ? ` (${failed} failed)` : ""}`,
    meta: {
      triggered_by: access.userId,
      total: docs.length,
      reclassified,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    },
  });

  return NextResponse.json({
    ok: true,
    total: docs.length,
    reclassified,
    failed,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ── scope=reclassify-all (GET) — preflight summary ──────────────────────
// Was GET /reclassify-all. Reports eligibleDocuments, stalePromptCount,
// neverClassifiedCount, currentPromptVersion, hasNewPromptVersion.

async function handleReclassifyAllPreflight(dealId: string) {
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "deal_not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const sb = supabaseAdmin();

  const { data: docs, error: docErr } = await (sb as any)
    .from("deal_documents")
    .select("id, gatekeeper_prompt_version, gatekeeper_classified_at, canonical_type")
    .eq("deal_id", dealId)
    .eq("bank_id", access.bankId)
    .not("storage_path", "is", null);

  if (docErr) {
    return NextResponse.json(
      { ok: false, error: `doc_load_failed: ${docErr.message}` },
      { status: 500 },
    );
  }

  const eligible = (docs ?? []) as Array<{
    gatekeeper_prompt_version: string | null;
    gatekeeper_classified_at: string | null;
  }>;
  const currentPromptVersion = getGeminiPromptVersion();

  const stalePromptCount = eligible.filter(
    (d) =>
      d.gatekeeper_prompt_version != null &&
      d.gatekeeper_prompt_version !== currentPromptVersion,
  ).length;
  const neverClassifiedCount = eligible.filter(
    (d) => !d.gatekeeper_classified_at,
  ).length;

  return NextResponse.json({
    ok: true,
    eligibleDocuments: eligible.length,
    stalePromptCount,
    neverClassifiedCount,
    currentPromptVersion,
    hasNewPromptVersion: stalePromptCount > 0 || neverClassifiedCount > 0,
  });
}

// ── scope=documents — was POST /reprocess-documents ─────────────────────
//
// **ADMIN-ONLY** branch. Retains the stricter requireDealCockpitAccess +
// COCKPIT_ROLES guard from the prior /reprocess-documents route. Do NOT
// collapse this onto ensureDealBankAccess — the prior route was guarded
// against banker-level access, and the consolidation must preserve that.

async function handleDocumentsAdmin(dealId: string) {
  const access = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }
  const { userId } = access;

  const sb = supabaseAdmin();

  // Load all classified documents for this deal
  const { data: docs } = await sb
    .from("deal_documents" as any)
    .select("id, document_type, ai_doc_type, canonical_type, original_filename")
    .eq("deal_id", dealId)
    .not("document_type", "is", null);

  if (!docs || docs.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No classified documents to reprocess",
      reprocessed: 0,
      total_facts_written: 0,
    });
  }

  let totalFacts = 0;
  let reprocessed = 0;
  const spreadTypesNeeded = new Set<SpreadType>();
  const errors: string[] = [];

  for (const doc of docs as any[]) {
    try {
      const docType = doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type;
      const result = await extractFactsFromDocument({
        dealId,
        bankId: access.bankId,
        documentId: doc.id,
        docTypeHint: docType,
      });
      totalFacts += result.factsWritten;
      reprocessed++;

      for (const st of spreadsForDocType(docType)) {
        spreadTypesNeeded.add(st);
      }
    } catch (err: any) {
      errors.push(`${doc.id}: ${err?.message ?? "unknown"}`);
    }
  }

  // Trigger spread orchestration after re-extraction
  if (reprocessed > 0) {
    spreadTypesNeeded.add("STANDARD");
    try {
      const { orchestrateSpreads } = await import(
        "@/lib/spreads/orchestrateSpreads"
      );
      await orchestrateSpreads(dealId, access.bankId, "recompute", userId);
    } catch (orchErr: any) {
      errors.push(`orchestrate: ${orchErr?.message ?? "unknown"}`);
    }
  }

  await logLedgerEvent({
    dealId,
    bankId: access.bankId,
    eventKey: "deal.reprocess_documents",
    uiState: "working",
    uiMessage: `Reprocessed ${reprocessed} documents (${totalFacts} facts)`,
    meta: {
      triggered_by: userId,
      reprocessed,
      total_facts_written: totalFacts,
      spread_types: Array.from(spreadTypesNeeded),
      errors: errors.length > 0 ? errors : undefined,
    },
  });

  return NextResponse.json({
    ok: true,
    reprocessed,
    total_facts_written: totalFacts,
    spread_types_enqueued: Array.from(spreadTypesNeeded),
    errors: errors.length > 0 ? errors : undefined,
  });
}
