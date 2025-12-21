import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * v1: If OCR output has no page markers, we create pseudo-pages by chunking.
 * Later: swap to Azure DI page-level text if you store it.
 */
function chunkText(text: string, targetChars = 3500) {
  const chunks: Array<{ page_number: number; page_text: string; global_start: number; global_end: number }> = [];
  const t = text || "";
  let i = 0;
  let page = 1;

  while (i < t.length) {
    const start = i;
    const end = Math.min(t.length, i + targetChars);

    // attempt to break on newline boundary
    let cut = end;
    const nl = t.lastIndexOf("\n", end);
    if (nl > start + 800) cut = nl;

    const pageText = t.slice(start, cut);
    chunks.push({ page_number: page, page_text: pageText, global_start: start, global_end: cut });

    i = cut;
    page++;
  }

  return chunks;
}

export async function ensurePageMapForAttachment(args: {
  dealId: string;
  attachmentId: string;
}) {
  const sb = supabaseAdmin();

  // If already exists, skip
  const existing = await sb
    .from("document_ocr_page_map")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("attachment_id", args.attachmentId)
    .limit(1);

  if (existing.error) throw existing.error;
  if ((existing.data || []).length > 0) return { ok: true, created: false };

  const ocr = await sb
    .from("document_ocr_results")
    .select("extracted_text")
    .eq("deal_id", args.dealId)
    .eq("attachment_id", args.attachmentId)
    .maybeSingle();

  if (ocr.error) throw ocr.error;
  const text = String(ocr.data?.extracted_text || "");
  if (!text) return { ok: false, error: "No OCR text to build page map" };

  const pages = chunkText(text, 3500);

  const rows = pages.map((p) => ({
    deal_id: args.dealId,
    attachment_id: args.attachmentId,
    page_number: p.page_number,
    page_text: p.page_text,
    global_char_start: p.global_start,
    global_char_end: p.global_end,
  }));

  const ins = await sb.from("document_ocr_page_map").insert(rows);
  if (ins.error) throw ins.error;

  return { ok: true, created: true, pages: pages.length };
}
