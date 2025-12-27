import { getSupabaseServerClient } from "@/lib/supabase/server";
import { embedQuery } from "@/lib/retrieval/retrieve";
import type { RetrievedChunk } from "@/lib/retrieval/types";

export type RetrievedPolicyChunk = {
  chunk_id: string;
  bank_id: string;
  content: string;
  source_label: string;
  similarity: number;
};

export async function retrieveBankPolicyChunks(opts: {
  bankId: string;
  question: string;
  k?: number;
}): Promise<RetrievedPolicyChunk[]> {
  const { bankId, question, k = 12 } = opts;
  const emb = await embedQuery(question);
  const sb = getSupabaseServerClient();

  const { data, error } = await sb.rpc("match_bank_policy_chunks", {
    in_bank_id: bankId,
    in_query_embedding: emb,
    in_match_count: k,
  });

  if (error) throw error;

  return (data || []).map((r: any) => ({
    chunk_id: r.chunk_id,
    bank_id: r.bank_id,
    content: r.content ?? "",
    source_label: r.source_label ?? "",
    similarity: typeof r.similarity === "number" ? r.similarity : Number(r.similarity ?? 0),
  }));
}

/**
 * Blend deal evidence and bank policy evidence into one list for LLM consumption.
 * We keep them separate by labeling in the final prompt.
 */
export function blendEvidence(opts: {
  deal: RetrievedChunk[];
  policy: RetrievedPolicyChunk[];
  maxDeal?: number;
  maxPolicy?: number;
}) {
  const maxDeal = opts.maxDeal ?? 10;
  const maxPolicy = opts.maxPolicy ?? 8;

  const deal = opts.deal.slice(0, maxDeal).map((c) => ({
    source_kind: "deal_doc_chunk" as const,
    chunk_id: c.chunk_id,
    upload_id: c.upload_id,
    content: c.content,
    similarity: c.similarity,
  }));

  const policy = opts.policy.slice(0, maxPolicy).map((c) => ({
    source_kind: "bank_policy_chunk" as const,
    chunk_id: c.chunk_id,
    bank_id: c.bank_id,
    source_label: c.source_label,
    content: c.content,
    similarity: c.similarity,
  }));

  return { deal, policy };
}
