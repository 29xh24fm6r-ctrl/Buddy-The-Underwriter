import { NextResponse } from \"next/server\";
import { supabaseAdmin } from \"@/lib/supabase/admin\";
import { requireRole } from \"@/lib/auth/requireRole\";
import type { PdfEvidenceSpan } from \"@/lib/evidence/pdfSpans\";

export const runtime = \"nodejs\";
export const dynamic = \"force-dynamic\";

/**
 * Get PDF URL and bounding boxes for evidence span navigation.
 * Banker-only endpoint for PDF overlay viewer.
 *
 * IMPORTANT: We normalize bounding boxes to [0..1] fractions of the page
 * so react-pdf overlays can position correctly using %.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; attachmentId: string }> },
) {
  await requireRole([\"super_admin\", \"bank_admin\", \"underwriter\"]);

  const { dealId, attachmentId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data: attachment, error: attachError } = await sb
    .from(\"deal_attachments\")
    .select(\"id, file_path, filename, content_type\")
    .eq(\"deal_id\", dealId)
    .eq(\"id\", attachmentId)
    .maybeSingle();

  if (attachError) {
    return NextResponse.json({ ok: false, error: attachError.message }, { status: 500 });
  }
  if (!attachment) {
    return NextResponse.json({ ok: false, error: \"Attachment not found\" }, { status: 404 });
  }

  const { data: ocrData, error: ocrError } = await sb
    .from(\"document_ocr_results\")
    .select(\"attachment_id, extracted_text, ocr_metadata\")
    .eq(\"deal_id\", dealId)
    .eq(\"attachment_id\", attachmentId)
    .maybeSingle();

  if (ocrError) {
    return NextResponse.json({ ok: false, error: ocrError.message }, { status: 500 });
  }

  const { data: intelData, error: intelError } = await sb
    .from(\"doc_intel_results\")
    .select(\"evidence_json\")
    .eq(\"deal_id\", dealId)
    .eq(\"file_id\", attachmentId)
    .maybeSingle();

  if (intelError && intelError.code !== \"PGRST116\") {
    return NextResponse.json({ ok: false, error: intelError.message }, { status: 500 });
  }

  const meta: any = ocrData?.ocr_metadata ?? null;

  function getAzurePages(m: any): any[] {
    if (!m) return [];
    if (Array.isArray(m.pages)) return m.pages;
    if (Array.isArray(m?.analyzeResult?.pages)) return m.analyzeResult.pages;
    if (Array.isArray(m?.analysis?.pages)) return m.analysis.pages;
    return [];
  }

  function getPageDims(pageNumber1: number): { w: number; h: number } | null {
    const pages = getAzurePages(meta);
    if (!pages.length) return null;

    // Azure pages may be 1-indexed (pageNumber) or implied by array index
    const byNumber = pages.find((p: any) => Number(p.pageNumber) === Number(pageNumber1));
    const p = byNumber ?? pages[pageNumber1 - 1];
    if (!p) return null;

    const w = Number(p.width);
    const h = Number(p.height);
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
    return { w, h };
  }

  function clamp01(x: number) {
    if (!isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  // Accept a variety of shapes and normalize into { page, x1,y1,x2,y2 } all in [0..1]
  function normalizeBoundingBox(bb: any): any | null {
    if (!bb) return null;

    const page = Number(bb.page ?? bb.page_num ?? bb.page_number ?? 1);
    if (!isFinite(page) || page < 1) return null;

    // Already normalized x1..y2?
    if ([\"x1\",\"y1\",\"x2\",\"y2\"].every((k) => typeof bb[k] === \"number\")) {
      const x1 = Number(bb.x1), y1 = Number(bb.y1), x2 = Number(bb.x2), y2 = Number(bb.y2);
      // Heuristic: if all coords <= 1.5 assume normalized
      if ([x1,y1,x2,y2].every((v) => isFinite(v) && v <= 1.5)) {
        return { page, x1: clamp01(x1), y1: clamp01(y1), x2: clamp01(x2), y2: clamp01(y2) };
      }
      // Otherwise treat as pixels and normalize using page dims if available
      const dims = getPageDims(page);
      if (dims) {
        return {
          page,
          x1: clamp01(x1 / dims.w),
          y1: clamp01(y1 / dims.h),
          x2: clamp01(x2 / dims.w),
          y2: clamp01(y2 / dims.h),
        };
      }
    }

    // Pixel-ish {x,y,width,height} or {left,top,width,height}
    const x = Number(bb.x ?? bb.left ?? 0);
    const y = Number(bb.y ?? bb.top ?? 0);
    const w = Number(bb.width ?? bb.w ?? 0);
    const h = Number(bb.height ?? bb.h ?? 0);
    if ([x,y,w,h].every((v) => isFinite(v)) && w > 0 && h > 0) {
      // If these look normalized already (<= ~1.5), treat as normalized
      if ([x,y,w,h].every((v) => v <= 1.5)) {
        return { page, x1: clamp01(x), y1: clamp01(y), x2: clamp01(x + w), y2: clamp01(y + h) };
      }
      const dims = getPageDims(page);
      if (dims) {
        return {
          page,
          x1: clamp01(x / dims.w),
          y1: clamp01(y / dims.h),
          x2: clamp01((x + w) / dims.w),
          y2: clamp01((y + h) / dims.h),
        };
      }
    }

    return null;
  }

  const evidenceSpansRaw: PdfEvidenceSpan[] =
    ((intelData?.evidence_json as any)?.evidence_spans || []) as PdfEvidenceSpan[];

  const evidenceSpansNormalized = evidenceSpansRaw.map((s: any) => {
    const bb = s?.bounding_box ?? s?.boundingBox ?? null;
    const nb = normalizeBoundingBox(bb);

    // Keep original fields, but ensure bounding_box is normalized when possible
    const out: any = { ...s };
    if (nb) out.bounding_box = nb;
    out._bounding_box_raw = bb ?? null;
    out._bounding_box_normalized = Boolean(nb);
    return out;
  });

  const filePath = attachment.file_path || `${dealId}/${attachment.filename}`;
  const { data: urlData } = await sb.storage.from(\"deal-documents\").createSignedUrl(filePath, 3600);
  const pdfUrl = urlData?.signedUrl || null;

  return NextResponse.json({
    ok: true,
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      content_type: attachment.content_type,
    },
    pdfUrl,
    ocrMetadata: meta,
    evidenceSpans: evidenceSpansNormalized,
  });
}
