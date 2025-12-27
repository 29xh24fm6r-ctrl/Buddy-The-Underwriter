import { getSupabaseServerClient } from "@/lib/supabase/server";

export type DealChunk = {
  chunk_id: string;
  upload_id: string;
  chunk_index: number | null;
  page_start: number | null;
  page_end: number | null;
  content: string;
  similarity: number;
};

/**
 * Retrieve deal document chunks using pgvector semantic search
 * @param opts - { dealId, queryEmbedding, k }
 * @returns Array of deal chunks with similarity scores
 */
export async function retrieveDealChunks(opts: {
  dealId: string;
  queryEmbedding: number[];
  k?: number;
}): Promise<DealChunk[]> {
  const { dealId, queryEmbedding, k = 10 } = opts;
  const sb = getSupabaseServerClient();

  const { data, error } = await sb.rpc("match_deal_doc_chunks", {
    in_deal_id: dealId,
    in_query_embedding: queryEmbedding,
    in_match_count: k,
  });

  if (error) throw error;

  return (data || []).map((r: any) => ({
    chunk_id: r.chunk_id,
    upload_id: r.upload_id,
    chunk_index: r.chunk_index ?? null,
    page_start: r.page_start ?? null,
    page_end: r.page_end ?? null,
    content: r.content ?? "",
    similarity: typeof r.similarity === "number" ? r.similarity : Number(r.similarity ?? 0),
  }));
}
