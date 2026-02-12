import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitPipelineEvent } from "@/lib/pulseMcp/emitPipelineEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map checklist_key to canonical document_type
const CHECKLIST_KEY_TO_DOC_TYPE: Record<string, string> = {
  IRS_PERSONAL_3Y: "PERSONAL_TAX_RETURN",
  IRS_PERSONAL_2Y: "PERSONAL_TAX_RETURN",
  PTR: "PERSONAL_TAX_RETURN",
  IRS_BUSINESS_3Y: "BUSINESS_TAX_RETURN",
  IRS_BUSINESS_2Y: "BUSINESS_TAX_RETURN",
  BTR: "BUSINESS_TAX_RETURN",
  PFS_CURRENT: "PFS",
  SBA_413: "PFS",
  FIN_STMT_PL_YTD: "INCOME_STATEMENT",
  FIN_STMT_BS_YTD: "BALANCE_SHEET",
  PROPERTY_T12: "T12",
  BANK_STMT_3M: "BANK_STATEMENT",
  RENT_ROLL: "RENT_ROLL",
  LEASES_TOP: "LEASE",
  PROPERTY_INSURANCE: "INSURANCE",
  APPRAISAL_IF_AVAILABLE: "APPRAISAL",
  OPERATING_AGREEMENT: "OPERATING_AGREEMENT",
  ARTICLES: "ARTICLES",
  K1: "K1",
  W2: "W2",
  "1099": "1099",
};

const BodySchema = z.object({
  checklist_key: z.union([z.string().trim().min(1), z.null()]).optional(),
  document_type: z.string().trim().min(1).optional(),
  tax_year: z.number().int().min(1990).max(2100).optional(),
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

  const checklistKey = body.checklist_key ?? null;
  const documentType =
    body.document_type || CHECKLIST_KEY_TO_DOC_TYPE[checklistKey || ""] || null;
  const taxYear = body.tax_year ?? null;
  const isClearing = !checklistKey;

  const sb = supabaseAdmin();

  // Get current state for audit trail
  const currentDoc = await sb
    .from("deal_documents")
    .select(
      "id, original_filename, checklist_key, document_type, doc_year, match_source, bank_id",
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

  // 1. Update deal_documents (canonical source)
  const docUpdate: Record<string, unknown> = {
    checklist_key: checklistKey,
    match_source: isClearing ? null : "manual",
    match_reason: isClearing ? null : "Manual classification by banker",
    match_confidence: isClearing ? null : 1.0,
    // Manual classification = banker has reviewed → finalize the document
    finalized_at: isClearing ? null : new Date().toISOString(),
  };
  if (documentType) docUpdate.document_type = documentType;
  if (taxYear !== null) {
    docUpdate.doc_year = taxYear;
    docUpdate.doc_years = [taxYear];
  }

  const upd = await sb
    .from("deal_documents")
    .update(docUpdate as any)
    .eq("deal_id", dealId)
    .eq("id", attachmentId)
    .select("id, checklist_key, document_type, doc_year")
    .maybeSingle();

  if (upd.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to update document", details: upd.error },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  if (!upd.data?.id) {
    return NextResponse.json(
      { ok: false, error: "Document not found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
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

  return NextResponse.json(
    {
      ok: true,
      attachmentId: upd.data.id,
      checklist_key: upd.data.checklist_key ?? null,
      document_type: (upd.data as any).document_type ?? null,
      manual_override: true,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
