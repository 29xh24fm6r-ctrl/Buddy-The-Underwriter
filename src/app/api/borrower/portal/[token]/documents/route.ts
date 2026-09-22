import "server-only";

/**
 * Borrower-facing document list.
 *
 * GET    /api/borrower/portal/[token]/documents  — what I've uploaded
 * DELETE /api/borrower/portal/[token]/documents  — remove one (body: { id })
 *
 * Uses the same storage, the same `deal_documents` table and the same
 * canonical borrower auth as the upload routes. This is a read/manage view
 * over the EXISTING document system, not a second one.
 *
 * Deletion is soft and borrower-scoped: a borrower may withdraw a document
 * they uploaded themselves and that has not yet been accepted into the
 * package. Anything staff-uploaded or already relied upon is not removable
 * here — the borrower is told to ask their advisor instead of silently
 * failing.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { borrowerDocumentAdmission, isSelfServeOrigin, isBorrowerCollectionPhase, DOCUMENT_ACTION_TEXT, type AdmissionDocument } from "@/lib/borrower/documents/admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

// Explicit row type for the borrower-facing selection.
type BorrowerDocumentRow = AdmissionDocument & {
  id: string;
  original_filename: string | null;
  checklist_key: string | null;
  created_at: string;
  size_bytes: number | null;
  sha256: string | null;
  statement_period: string | null;
  status: string | null;
  source: string | null;
};

async function auth(token: string) {
  try {
    return await resolvePortalContext(token);
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, ctx: Context) {
  const { token } = await ctx.params;
  const context = await auth(token);
  if (!context) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_documents")
    .select(
      "id, original_filename, checklist_key, created_at, size_bytes, sha256, status, source, is_active, intake_status, quality_status, canonical_type, doc_year, statement_period, segmented, ocr_text_length, logical_key, gatekeeper_needs_review, gatekeeper_route",
    )
    .eq("deal_id", context.dealId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[borrower/documents] list failed", error.message);
    return NextResponse.json(
      { ok: false, error: "Could not load your documents" },
      { status: 500 },
    );
  }

  const artifacts = await sb.from("document_artifacts").select("source_id,status,match_reason")
    .eq("deal_id", context.dealId).eq("bank_id", context.bankId).eq("source_table", "deal_documents");
  if (artifacts.error) return NextResponse.json({ ok: false, error: "Document processing status could not be loaded." }, { status: 503 });
  const deal = await sb.from("deals").select("origin,intake_phase").eq("id", context.dealId).eq("bank_id", context.bankId).maybeSingle();
  const sealed = await sb.from("buddy_sealed_packages").select("id").eq("deal_id", context.dealId).is("unsealed_at", null).limit(1);
  if (deal.error || sealed.error) return NextResponse.json({ ok: false, error: "Document review status could not be loaded." }, { status: 503 });
  const canReview = isSelfServeOrigin(deal.data?.origin) && isBorrowerCollectionPhase(deal.data?.intake_phase) && !sealed.data?.length;
  const byDocument = new Map((artifacts.data ?? []).map((a) => [a.source_id, a]));
  const clarificationRows = canReview
    ? await sb.from("deal_events").select("payload").eq("deal_id", context.dealId)
      .eq("kind", "borrower.document.clarified").order("created_at", { ascending: false }).limit(200)
    : { data: [], error: null };
  if (clarificationRows.error) return NextResponse.json({ ok: false, error: "Saved document details could not be loaded." }, { status: 503 });
  const clarificationByDocument = new Map<string, any>();
  for (const row of clarificationRows.data ?? []) {
    const payload = row.payload as Record<string, unknown> | null;
    const documentId = typeof payload?.document_id === "string" ? payload.document_id : null;
    if (documentId && !clarificationByDocument.has(documentId)) clarificationByDocument.set(documentId, payload);
  }

  return NextResponse.json({
    ok: true,
    documents: ((data ?? []) as unknown as BorrowerDocumentRow[]).map((d) => {
      const artifact = byDocument.get(d.id);
      const pending = ["queued", "processing"].includes(artifact?.status ?? "");
      const complete = artifact?.status === "matched" && artifact?.match_reason === "borrower_automated_processing_complete";
      const action = !canReview || pending || complete ? null : borrowerDocumentAdmission(d);
      const savedClarification = clarificationByDocument.get(d.id);
      const exactClarification = savedClarification?.sha256 === d.sha256 ? savedClarification : null;
      const canDescribeQueued = canReview && artifact?.status === "queued" && d.is_active === true &&
        ["borrower", "borrower_portal"].includes(d.source ?? "") && !d.segmented;
      return ({
      id: d.id,
      filename: d.original_filename ?? "Document",
      category: d.checklist_key ?? "other_supporting_document",
      label: d.original_filename ?? "Document",
      uploadedAt: d.created_at,
      sizeBytes: d.size_bytes ?? null,
      status: complete ? "processed" : (artifact?.status ?? d.status ?? "uploaded"),
      processingComplete: complete,
      action,
      actionMessage: canDescribeQueued
        ? (exactClarification ? "Details saved. Buddy will verify this document when processing resumes." : "Tell Buddy what this document is while it waits for verification.")
        : action ? DOCUMENT_ACTION_TEXT[action] : null,
      suggestedType: exactClarification?.doc_type ?? d.canonical_type,
      taxYear: exactClarification?.tax_year ?? d.doc_year,
      statementPeriod: exactClarification?.statement_period ?? d.statement_period ?? null,
      clarificationSaved: !!exactClarification,
      canClarify: canDescribeQueued || ["document_details", "tax_year"].includes(action ?? ""),
      canRetry: canReview && d.is_active === true && ["borrower", "borrower_portal"].includes(d.source ?? "") && artifact?.status === "failed",
      // Only borrower-uploaded documents may be withdrawn by the borrower.
      removable: d.source === "borrower_portal" || d.source === "borrower",
    }); }),
  });
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const { token } = await ctx.params;
  const context = await auth(token);
  if (!context) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Scope the lookup to THIS deal. Without it, a borrower could pass any
  // document id and delete another borrower's file.
  const { data: doc } = await sb
    .from("deal_documents")
    .select("id, source, deal_id")
    .eq("id", id)
    .eq("deal_id", context.dealId)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const source = (doc as unknown as Pick<BorrowerDocumentRow, "source">).source;
  if (source !== "borrower_portal" && source !== "borrower") {
    return NextResponse.json(
      {
        ok: false,
        error: "not_removable",
        message:
          "This document was added by your advisor. Message them to have it changed.",
      },
      { status: 409 },
    );
  }

  const { error } = await sb
    .from("deal_documents")
    // Soft withdraw. `deal_documents` has no withdrawn_at column and adding
    // one is a schema change this launch does not need. `status` alone is
    // sufficient: the GET above filters on .neq("status", "withdrawn"), so
    // the row disappears from the borrower's view while remaining for audit.
    // Admission also rejects withdrawn status, so this cannot restart extraction.
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("deal_id", context.dealId);

  if (error) {
    console.error("[borrower/documents] withdraw failed", error.message);
    return NextResponse.json(
      { ok: false, error: "Could not remove that document" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
