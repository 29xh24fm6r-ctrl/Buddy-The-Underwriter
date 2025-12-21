import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensurePageMapForAttachment } from "@/lib/evidence/pageMap";
import { extractNormalizedWordBoxesFromAzure } from "@/lib/evidence/azureDiGeometry";
import { alignWordsToPageText } from "@/lib/evidence/wordCharAlign";

export async function ensureGeometryForAttachment(args: { dealId: string; attachmentId: string }) {
  const sb = supabaseAdmin();

  // If already exists, skip
  const existing = await sb
    .from("document_ocr_words")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("attachment_id", args.attachmentId)
    .limit(1);

  if (existing.error) throw existing.error;
  if ((existing.data || []).length > 0) return { ok: true, created: false };

  // Ensure page_map exists
  await ensurePageMapForAttachment({ dealId: args.dealId, attachmentId: args.attachmentId });

  // Load OCR raw_json + extracted_text exists already
  const ocr = await sb
    .from("document_ocr_results")
    .select("raw_json") // <- if your column differs, Cursor updates selector here
    .eq("deal_id", args.dealId)
    .eq("attachment_id", args.attachmentId)
    .maybeSingle();

  if (ocr.error) throw ocr.error;

  const raw = ocr.data?.raw_json;
  if (!raw) {
    // no geometry available; don't fail—just degrade
    return { ok: true, created: false, note: "No raw_json geometry present" };
  }

  const wordBoxes = extractNormalizedWordBoxesFromAzure(raw);
  if (!wordBoxes.length) {
    return { ok: true, created: false, note: "No words extracted from raw_json" };
  }

  // Fetch page_map page_text for alignment
  const pm = await sb
    .from("document_ocr_page_map")
    .select("page_number, page_text")
    .eq("deal_id", args.dealId)
    .eq("attachment_id", args.attachmentId)
    .order("page_number", { ascending: true });

  if (pm.error) throw pm.error;

  const pageTextByNum = new Map<number, string>();
  for (const row of pm.data || []) {
    pageTextByNum.set(Number(row.page_number), String(row.page_text || ""));
  }

  // group wordBoxes by page number and align
  const inserts: any[] = [];
  const pages = new Map<number, any[]>();
  for (const w of wordBoxes) {
    const arr = pages.get(w.page_number) || [];
    arr.push(w);
    pages.set(w.page_number, arr);
  }

  for (const [pageNum, words] of pages.entries()) {
    const pageText = pageTextByNum.get(pageNum) || "";
    const aligned = alignWordsToPageText({
      pageText,
      words: words.map((x) => ({
        content: x.content,
        x1: x.x1,
        y1: x.y1,
        x2: x.x2,
        y2: x.y2,
        word_index: x.word_index,
      })),
    });

    for (const w of aligned) {
      inserts.push({
        deal_id: args.dealId,
        attachment_id: args.attachmentId,
        page_number: pageNum,
        word_index: w.word_index,
        content: w.content,
        x1: w.x1,
        y1: w.y1,
        x2: w.x2,
        y2: w.y2,
        page_char_start: Number(w.page_char_start || 0),
        page_char_end: Number(w.page_char_end || 0),
      });
    }
  }

  // Insert in chunks (safe)
  const chunkSize = 1000;
  for (let i = 0; i < inserts.length; i += chunkSize) {
    const chunk = inserts.slice(i, i + chunkSize);
    const ins = await sb.from("document_ocr_words").insert(chunk);
    if (ins.error) throw ins.error;
  }

  return { ok: true, created: true, words: inserts.length };
}
