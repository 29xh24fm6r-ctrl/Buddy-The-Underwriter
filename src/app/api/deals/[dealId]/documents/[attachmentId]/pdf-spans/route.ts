import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import type { PdfEvidenceSpan } from "@/lib/evidence/pdfSpans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Get PDF URL and bounding boxes for evidence span navigation.
 * Banker-only endpoint for PDF overlay viewer.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; attachmentId: string }> },
) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);

  const { dealId, attachmentId } = await ctx.params;
  const sb = supabaseAdmin();

  // Get attachment metadata (file path for PDF URL)
  const { data: attachment, error: attachError } = await sb
    .from("deal_attachments")
    .select("id, file_path, filename, content_type")
    .eq("deal_id", dealId)
    .eq("id", attachmentId)
    .maybeSingle();

  if (attachError) {
    return NextResponse.json(
      { ok: false, error: attachError.message },
      { status: 500 },
    );
  }

  if (!attachment) {
    return NextResponse.json(
      { ok: false, error: "Attachment not found" },
      { status: 404 },
    );
  }

  // Get OCR results with bounding boxes (if available)
  const { data: ocrData, error: ocrError } = await sb
    .from("document_ocr_results")
    .select("attachment_id, extracted_text, ocr_metadata")
    .eq("deal_id", dealId)
    .eq("attachment_id", attachmentId)
    .maybeSingle();

  if (ocrError) {
    return NextResponse.json(
      { ok: false, error: ocrError.message },
      { status: 500 },
    );
  }

  // Get evidence spans from doc intel results
  const { data: intelData, error: intelError } = await sb
    .from("doc_intel_results")
    .select("evidence_json")
    .eq("deal_id", dealId)
    .eq("file_id", attachmentId)
    .maybeSingle();

  if (intelError && intelError.code !== "PGRST116") {
    // Ignore "not found" errors
    return NextResponse.json(
      { ok: false, error: intelError.message },
      { status: 500 },
    );
  }

  const evidenceSpans: PdfEvidenceSpan[] =
    (intelData?.evidence_json as any)?.evidence_spans || [];

  // Generate presigned URL for PDF access
  // Note: Supabase storage paths need to be constructed carefully
  const filePath = attachment.file_path || `${dealId}/${attachment.filename}`;

  const { data: urlData } = await sb.storage
    .from("deal-documents")
    .createSignedUrl(filePath, 3600); // 1 hour expiry

  const pdfUrl = urlData?.signedUrl || null;

  return NextResponse.json({
    ok: true,
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      content_type: attachment.content_type,
    },
    pdfUrl,
    ocrMetadata: ocrData?.ocr_metadata || null,
    evidenceSpans,
  });
}
