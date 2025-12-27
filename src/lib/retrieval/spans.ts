import { getSupabaseServerClient } from "@/lib/supabase/server";
import { mapEvidenceChunkRow } from "@/lib/db/rowCase";

export async function lookupBestSpanForChunk(opts: { dealId: string; chunkId: string }) {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("deal_doc_chunk_spans")
    .select("document_id, upload_id, page_number, bbox, text_excerpt")
    .eq("deal_id", opts.dealId)
    .eq("chunk_id", opts.chunkId ?? opts.chunk_id)
    .order("page_number", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}