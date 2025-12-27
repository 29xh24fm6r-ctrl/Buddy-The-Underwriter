import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getOpenAI } from "@/lib/ai/openaiClient";
import type { RetrievedChunk } from "@/lib/retrieval/types";

export type { RetrievedChunk };

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

export async function embedQuery(text: string): Promise<number[]> {
  const openai = getOpenAI();
  const resp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  const v = resp.data?.[0]?.embedding;
  if (!v?.length) throw new Error("Empty embedding from OpenAI");
  return v as number[];
}

/**
 * Retrieve top-K chunks using semantic search (pgvector)
 * @param opts - { dealId, question, k }
 * @returns Array of chunks sorted by similarity (highest first)
 */
export async function retrieveTopChunks(opts: {
  dealId: string;
  question: string;
  k?: number;
}): Promise<RetrievedChunk[]> {
  const { dealId, question, k = 20 } = opts;

  const queryEmbedding = await embedQuery(question);
  const sb = getSupabaseServerClient();

  const { data, error } = await sb.rpc("match_deal_doc_chunks", {
    in_deal_id: dealId,
    in_query_embedding: queryEmbedding,
    in_match_count: k,
  });

  if (error) throw error;

  // Supabase returns unknown[]; normalize
  return (data || []).map((r: any) => ({
    chunk_id: r.chunk_id,
    upload_id: r.upload_id,
    page_start: r.page_start ?? null,
    page_end: r.page_end ?? null,
    content: r.content ?? "",
    similarity: typeof r.similarity === "number" ? r.similarity : Number(r.similarity ?? 0),
  })) satisfies RetrievedChunk[];
}
