import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { emitPipelineEvent } from "@/lib/pulseMcp/emitPipelineEvent";
import { SEGMENTATION_VERSION } from "@/lib/intake/segmentation/types";
import { extractFilenamePattern } from "@/lib/intake/overrideIntelligence/extractFilenamePattern";
import { resolveChecklistKey } from "@/lib/docTyping/resolveChecklistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Body only accepts canonical_type + tax_year.
// checklist_key is DERIVED internally — never accepted from the client.
const BodySchema = z.object({
  canonical_type: z.string().trim().min(1).optional().nullable(),
  tax_year: z.number().int().min(1990).max(2100).optional().nullable(),
});

/**
 * PATCH /api/deals/[dealId]/documents/[attachmentId]/checklist-key
 *
 * Manual override to stamp deal_documents.checklist_key and trigger checklist reconcile.
 * Sets match_source = "manual" so AI will NEVER overwrite this classification.
 * Also syncs document_artifacts, logs audit trail, and recomputes readiness.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; attachmentId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const { dealId, attachmentId } = await ctx.params;

  const ensured = await ensureDealBankAccess(dealId);
  if (!ensured.ok) {
    const statusCode =
      ensured.error === "deal_not_found"
        ? 404
        : ensured.error === "tenant_mismatch"
          ? 403
          : 401;
    return NextResponse.json(
      { ok: false, error: ensured.error },
      { status: statusCode, headers: { "cache-control": "no-store" } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const canonicalType = body.canonical_type ?? null;
  const taxYear = body.tax_year ?? null;
  const isClearing = !canonicalType;

  // checklist_key is derived deterministically — never from client input
  const checklistKey = canonicalType ? resolveChecklistKey(canonicalType, taxYear) : null;
  const documentType = canonicalType; // canonical_type IS the document type

  const sb = supabaseAdmin();

  // Get current state for audit trail
  const currentDoc = await sb
    .from("deal_documents")
    .select(
      "id, original_filename, checklist_key, document_type, doc_year, match_source, bank_id, classification_tier, classification_version, match_confidence, gatekeeper_route",
    )
    .eq("deal_id", dealId)
    .eq("id", attachmentId)
    .maybeSingle();

  if (!currentDoc.data?.id) {
    return NextResponse.json(
      { ok: false, error: "Document not found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const bankId = currentDoc.data.bank_id || ensured.bankId;
  const previousState = {
    checklist_key: currentDoc.data.checklist_key,
    document_type: currentDoc.data.document_type,
    doc_year: currentDoc.data.doc_year,
  };

  // ── Phase F: Atomic retype via single-transaction RPC ────────────────
  // canonical_type → checklist_key → reconcile all happen inside one DB tx.
  // No partial updates. No UI-supplied checklist_key accepted.
  if (!isClearing && canonicalType) {
    // Set doc_year + match metadata first (RPC only handles type + key + reconcile)
    if (taxYear !== null) {
      await sb
        .from("deal_documents")
        .update({
          doc_year: taxYear,
          doc_years: [taxYear],
          match_source: "manual",
          match_reason: "Manual classification by banker",
          match_confidence: 1.0,
          finalized_at: new Date().toISOString(),
        } as any)
        .eq("id", attachmentId);
    }

    const rpcRes = await sb.rpc("atomic_retype_document", {
      p_document_id: attachmentId,
      p_new_canonical_type: canonicalType,
    });

    if (rpcRes.error) {
      return NextResponse.json(
        { ok: false, error: "Atomic retype failed", details: rpcRes.error },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }

    // Stamp remaining metadata that the RPC doesn't handle
    await sb
      .from("deal_documents")
      .update({
        match_source: "manual",
        match_reason: "Manual classification by banker",
        match_confidence: 1.0,
        finalized_at: new Date().toISOString(),
      } as any)
      .eq("id", attachmentId);
  } else if (isClearing) {
    // Clearing: reset all classification fields
    await sb
      .from("deal_documents")
      .update({
        checklist_key: null,
        canonical_type: null,
        document_type: null,
        match_source: null,
        match_reason: null,
        match_confidence: null,
        finalized_at: null,
      } as any)
      .eq("id", attachmentId);
  }

  // Re-read document state after atomic update
  const upd = await sb
    .from("deal_documents")
    .select("id, checklist_key, document_type, doc_year")
    .eq("deal_id", dealId)
    .eq("id", attachmentId)
    .maybeSingle();

  if (upd.error || !upd.data?.id) {
    return NextResponse.json(
      { ok: false, error: "Document not found after update" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  // 1b. Re-match via matching engine after manual classification
  // Single source of truth: slot routing always flows through the matching engine.
  // runMatchForDocument handles old-slot release, constraint evaluation, and attachment.
  if (!isClearing && documentType) {
    try {
      const { runMatchForDocument } = await import(
        "@/lib/intake/matching/runMatch"
      );
      await runMatchForDocument({
        dealId,
        bankId,
        documentId: attachmentId,
        spine: null,
        gatekeeper: {
          docType: documentType,
          confidence: 1.0,
          taxYear: taxYear,
          formNumbers: [],
          effectiveDocType: documentType,
        },
        matchSource: "manual",
      });
    } catch (e) {
      console.warn("[checklist-key] re-match after override failed (non-fatal)", e);
    }
  }

  // 2. Update document_artifacts (prevents AI re-classification)
  try {
    await sb
      .from("document_artifacts")
      .update({
        matched_checklist_key: checklistKey,
        match_confidence: isClearing ? null : 1.0,
        match_reason: isClearing ? null : "Manual override by banker",
        status: isClearing ? "pending" : "matched",
        doc_type: documentType?.toUpperCase() || null,
        doc_type_confidence: isClearing ? null : 1.0,
        doc_type_reason: isClearing ? null : "Manual classification by banker",
        tax_year: taxYear,
      } as any)
      .eq("deal_id", dealId)
      .eq("source_id", attachmentId)
      .eq("source_table", "deal_documents");
  } catch (e) {
    console.warn("[checklist-key] artifact update failed (non-fatal)", e);
  }

  // 2b. Create checklist_item_matches row (parity with AI path)
  if (checklistKey && !isClearing) {
    try {
      const artifactRes = await sb
        .from("document_artifacts")
        .select("id")
        .eq("deal_id", dealId)
        .eq("source_id", attachmentId)
        .eq("source_table", "deal_documents")
        .maybeSingle();

      if (artifactRes.data?.id) {
        await sb.rpc("create_checklist_match", {
          p_deal_id: dealId,
          p_bank_id: bankId,
          p_artifact_id: artifactRes.data.id,
          p_checklist_key: checklistKey,
          p_confidence: 1.0,
          p_reason: "Manual classification by banker",
          p_match_source: "manual",
          p_tax_year: taxYear,
          p_auto_apply: true,
        });
      }
    } catch (e) {
      console.warn("[checklist-key] create_checklist_match RPC failed (non-fatal)", e);
    }
  }

  // 3. Log audit trail
  try {
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "document.manual_override",
      uiState: "done",
      uiMessage: isClearing
        ? `Classification cleared for ${currentDoc.data.original_filename}`
        : `${currentDoc.data.original_filename} → ${checklistKey}`,
      meta: {
        document_id: attachmentId,
        filename: currentDoc.data.original_filename,
        previous: previousState,
        new: {
          canonical_type: canonicalType,
          checklist_key: checklistKey,
          document_type: documentType,
          doc_year: taxYear,
        },
        classified_by: userId,
      },
    });
  } catch (e) {
    console.warn("[checklist-key] ledger event failed (non-fatal)", e);
  }

  // Spine v2: classification.manual_override event
  if (!isClearing) {
    try {
      await writeEvent({
        dealId,
        kind: "classification.manual_override",
        actorUserId: userId,
        scope: "classification",
        action: "manual_override",
        confidence: 1.0,
        meta: {
          document_id: attachmentId,
          original_type: previousState.document_type,
          original_tier: (currentDoc.data as any).classification_tier ?? null,
          original_version: (currentDoc.data as any).classification_version ?? null,
          corrected_type: documentType,
          corrected_checklist_key: checklistKey,
          classified_by: userId,
          // Phase B: Override Intelligence enrichment fields
          confidence_at_time: (currentDoc.data as any).match_confidence ?? null,
          classifier_source: currentDoc.data.match_source ?? null,
          classification_version: (currentDoc.data as any).classification_version ?? null,
          filename_pattern: extractFilenamePattern(currentDoc.data.original_filename),
          match_result_state: (currentDoc.data as any).gatekeeper_route ?? null,
          segmentation_version: SEGMENTATION_VERSION,
          entity_binding_state: null,              // reserved — populated in Phase C
          intake_health_score_at_time: null,        // reserved — populated in Phase C
        },
      });
    } catch (e) {
      console.warn("[checklist-key] classification.manual_override ledger event failed (non-fatal)", e);
    }
  }

  // Pulse: manual override applied
  void emitPipelineEvent({
    kind: "manual_override",
    deal_id: dealId,
    bank_id: bankId,
    payload: {
      checklist_key: checklistKey,
      document_type: documentType,
      match_source: "manual",
    },
  });

  // 4. Reconcile checklist
  try {
    await reconcileChecklistForDeal({ sb, dealId });
  } catch (e) {
    console.error("[checklist-key] reconcile failed (non-fatal)", e);
  }

  // 5. Recompute deal readiness
  try {
    const { recomputeDealReady } = await import("@/lib/deals/readiness");
    await recomputeDealReady(dealId);
  } catch (e) {
    console.warn("[checklist-key] readiness recompute failed (non-fatal)", e);
  }

  // 6. E2: Trigger spread orchestration after doc change
  if (!isClearing && documentType) {
    try {
      const { orchestrateSpreads } = await import(
        "@/lib/spreads/orchestrateSpreads"
      );
      await orchestrateSpreads(dealId, bankId, "doc_change", userId);
    } catch (e: any) {
      console.warn("[checklist-key] spread orchestration failed (non-fatal)", e);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      attachmentId: upd.data.id,
      checklist_key: upd.data.checklist_key ?? null,
      document_type: (upd.data as any).document_type ?? null,
      doc_year: (upd.data as any).doc_year ?? null,
      manual_override: true,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
