import { supabaseServer } from "./supabaseServer";
import { embedText } from "./embeddings";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  similarity: number;
};

/**
 * Retrieve top-K evidence chunks using semantic search (pgvector)
 * @param args - { dealId, query, k }
 * @returns Array of chunks sorted by similarity (highest first)
 */
export async function retrieveTopChunks(args: {
  dealId: string;
  query: string;
  k?: number;
}): Promise<RetrievedChunk[]> {
  const sb = supabaseServer();
  const k = args.k ?? 12;

  // Generate query embedding
  const qv = await embedText(args.query);

  // Call RPC function for vector similarity search
  const { data, error } = await sb.rpc("match_evidence_chunks", {
    in_deal_id: args.dealId,
    in_query_embedding: qv,
    in_match_count: k,
  });

  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    content: r.content,
    similarity: r.similarity,
  }));
}
