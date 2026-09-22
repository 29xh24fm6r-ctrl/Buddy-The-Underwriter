import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readBorrowerDocument, resumeBorrowerDocuments } from "@/lib/borrower/documents/service";
import { ClarificationSchema } from "@/lib/borrower/documents/clarification";
import { isBorrowerCollectionPhase } from "@/lib/borrower/documents/admission";
import { QUALITY_THRESHOLDS } from "@/lib/intake/quality/evaluateDocumentQuality";
import { resolveDocTyping } from "@/lib/docs/typing/resolveDocTyping";
import { resolveChecklistKey, PERIOD_REQUIRED_TYPES } from "@/lib/docTyping/resolveChecklistKey";
import { YEAR_REQUIRED_TYPES } from "@/lib/intake/confirmation/computeDocBlockers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Body = z.object({ documentId: z.string().uuid().optional(), clarification: ClarificationSchema.optional() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  let context;
  try { context = await resolvePortalContext((await ctx.params).token); }
  catch { return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 }); }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Check the document details and try again." }, { status: 400 });
  const { dealId, bankId } = context;
  try {
    const sb = supabaseAdmin();
    if (!parsed.data.documentId) {
      if (parsed.data.clarification) return NextResponse.json({ ok: false, error: "Choose a document." }, { status: 400 });
      return NextResponse.json({ ok: true, queued: await resumeBorrowerDocuments(dealId, bankId, sb) });
    }
    const documentId = parsed.data.documentId;
    const current = await readBorrowerDocument(dealId, bankId, documentId, sb);
    if (!current) return NextResponse.json({ ok: false, error: "Document not available." }, { status: 404 });
    const { doc, phase } = current;
    if (!isBorrowerCollectionPhase(phase) || doc.is_active !== true || doc.intake_status === "LOCKED_FOR_PROCESSING")
      return NextResponse.json({ ok: false, error: "This document is already locked or has been replaced." }, { status: 409 });
    const clarification = parsed.data.clarification;
    if (clarification) {
      const definitelyUnreadable = ["FAILED_OCR_ERROR", "FAILED_LOW_TEXT"].includes(doc.quality_status ?? "") ||
        ((doc.ocr_text_length ?? 0) > 0 && (doc.ocr_text_length ?? 0) < QUALITY_THRESHOLDS.MIN_TEXT_LENGTH);
      if (!doc.sha256 || doc.segmented || definitelyUnreadable)
        return NextResponse.json({ ok: false, error: "Please upload a complete, readable copy, with each document in a separate file." }, { status: 422 });
      if (YEAR_REQUIRED_TYPES.has(clarification.doc_type) && !clarification.tax_year)
        return NextResponse.json({ ok: false, error: "Enter the tax year printed on this return." }, { status: 422 });
      if (PERIOD_REQUIRED_TYPES.has(clarification.doc_type) && !resolveChecklistKey(clarification.doc_type, clarification.tax_year, clarification.statement_period))
        return NextResponse.json({ ok: false, error: "Choose the period this financial statement covers." }, { status: 422 });
      const ownerRequired = ["PERSONAL_TAX_RETURN", "BUSINESS_TAX_RETURN", "PFS", "PERSONAL_FINANCIAL_STATEMENT"].includes(clarification.doc_type);
      if (ownerRequired && !clarification.ownership_entity_id)
        return NextResponse.json({ ok: false, error: "Choose the person or business named on this document." }, { status: 422 });
      if (clarification.ownership_entity_id) {
        const owner = await sb.from("ownership_entities").select("id").eq("id", clarification.ownership_entity_id)
          .eq("deal_id", dealId).maybeSingle();
        if (owner.error) throw new Error("Document owner could not be verified.");
        if (!owner.data) return NextResponse.json({ ok: false, error: "Choose an owner from this application." }, { status: 422 });
      }
      const typed = resolveDocTyping({ aiDocType: clarification.doc_type, aiTaxYear: clarification.tax_year, aiFormNumbers: doc.ai_form_numbers, aiConfidence: 1, aiEntityType: null });
      if (typed.guardrail_applied) return NextResponse.json({ ok: false, error: "The document type does not match the form number on this file." }, { status: 422 });
      const saved = await sb.from("deal_events").insert({ deal_id: dealId, kind: "borrower.document.clarified", payload: { document_id: documentId, sha256: doc.sha256, ...clarification, source: "authenticated_borrower" } });
      if (saved.error) throw new Error("Your document details could not be saved.");
    }
    const artifact = await sb.from("document_artifacts").select("id,status")
      .eq("deal_id", dealId).eq("bank_id", bankId).eq("source_table", "deal_documents").eq("source_id", documentId)
      .maybeSingle();
    if (artifact.error) throw new Error("Document processing status could not be loaded.");
    if (clarification && artifact.data?.status === "queued") {
      return NextResponse.json({ ok: true, queued: 0, processing: true, clarificationSaved: true });
    }
    const queued = await sb.from("document_artifacts").update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("deal_id", dealId).eq("bank_id", bankId).eq("source_table", "deal_documents").eq("source_id", documentId)
      .in("status", ["classified", "routed_to_review", "failed"]).select("id");
    if (queued.error) throw new Error("Processing could not restart. Please retry.");
    if (!queued.data?.length) return NextResponse.json({ ok: false, error: "This file is already processing or no longer available for retry. Refresh the document list before trying again." }, { status: 409 });
    return NextResponse.json({ ok: true, queued: queued.data?.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Document processing is temporarily unavailable." }, { status: 503 });
  }
}
