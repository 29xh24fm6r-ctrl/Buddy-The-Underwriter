import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureGeometryForAttachment } from "@/lib/evidence/ensureGeometry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function overlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.max(a1, b1) < Math.min(a2, b2);
}

export async function GET(_req: Request, ctx: { params: { dealId: string; memoId: string } }) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const { dealId, memoId } = ctx.params;
  const sb = supabaseAdmin();

  // Choose attachment(s) from citations
  const cits = await sb
    .from("credit_memo_citations")
    .select("id, block_id, attachment_id, page_number, page_char_start, page_char_end, global_char_start, global_char_end, label")
    .eq("deal_id", dealId)
    .eq("memo_draft_id", memoId);

  if (cits.error) return NextResponse.json({ ok: false, error: cits.error.message }, { status: 500 });

  const citations = cits.data || [];
  const attachmentIds = Array.from(new Set(citations.map((c) => String(c.attachment_id)).filter(Boolean)));

  // Ensure geometry for all referenced attachments
  for (const attachmentId of attachmentIds) {
    await ensureGeometryForAttachment({ dealId, attachmentId });
  }

  // Load page_map for global->page conversion
  const pm = await sb
    .from("document_ocr_page_map")
    .select("attachment_id, page_number, global_char_start, global_char_end, page_text")
    .eq("deal_id", dealId);

  if (pm.error) return NextResponse.json({ ok: false, error: pm.error.message }, { status: 500 });

  const pageMap = (pm.data || []).map((x) => ({
    attachment_id: String(x.attachment_id),
    page_number: Number(x.page_number),
    global_char_start: Number(x.global_char_start || 0),
    global_char_end: Number(x.global_char_end || 0),
    page_text_len: String(x.page_text || "").length,
  }));

  // For each citation: compute page_number + page_char_start/end if missing
  const resolved = citations.map((c) => {
    const attachmentId = String(c.attachment_id);
    let pageNum = c.page_number ? Number(c.page_number) : 0;
    let pStart = c.page_char_start != null ? Number(c.page_char_start) : null;
    let pEnd = c.page_char_end != null ? Number(c.page_char_end) : null;

    const gStart = c.global_char_start != null ? Number(c.global_char_start) : 0;
    const gEnd = c.global_char_end != null ? Number(c.global_char_end) : 0;

    if ((!pageNum || pStart == null || pEnd == null) && gEnd > gStart) {
      const match = pageMap.find((p) => p.attachment_id === attachmentId && gStart >= p.global_char_start && gStart < p.global_char_end);
      if (match) {
        pageNum = match.page_number;
        pStart = Math.max(0, gStart - match.global_char_start);
        pEnd = Math.max(pStart, Math.min(match.page_text_len, gEnd - match.global_char_start));
      }
    }

    return {
      id: String(c.id),
      block_id: String(c.block_id),
      attachment_id: attachmentId,
      page_number: pageNum || null,
      page_char_start: pStart,
      page_char_end: pEnd,
      global_char_start: gStart,
      global_char_end: gEnd,
      label: c.label ? String(c.label) : null,
    };
  });

  // Fetch overlapping words for each citation and return normalized boxes
  const overlays: any[] = [];

  for (const c of resolved) {
    if (!c.page_number || c.page_char_start == null || c.page_char_end == null) continue;
    if (c.page_char_end <= c.page_char_start) continue;

    const words = await sb
      .from("document_ocr_words")
      .select("page_number, word_index, x1, y1, x2, y2, page_char_start, page_char_end")
      .eq("deal_id", dealId)
      .eq("attachment_id", c.attachment_id)
      .eq("page_number", c.page_number)
      .order("word_index", { ascending: true });

    if (words.error) continue;

    const hit = (words.data || []).filter((w: any) =>
      overlap(
        Number(w.page_char_start || 0),
        Number(w.page_char_end || 0),
        Number(c.page_char_start),
        Number(c.page_char_end)
      )
    );

    overlays.push({
      citation_id: c.id,
      block_id: c.block_id,
      attachment_id: c.attachment_id,
      page_number: c.page_number,
      label: c.label,
      global_char_start: c.global_char_start,
      global_char_end: c.global_char_end,
      boxes: hit.map((w: any) => ({
        x1: Number(w.x1),
        y1: Number(w.y1),
        x2: Number(w.x2),
        y2: Number(w.y2),
      })),
    });
  }

  return NextResponse.json({ ok: true, overlays });
}
