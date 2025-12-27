/**
 * Unified Retrieval Interface
 * 
 * Single function for retrieving context from all knowledge sources:
 * - Deal documents (uploaded files)
 * - Bank policies (internal guidelines)
 * - SBA policies (rules + regulations)
 * 
 * Returns blended results with consistent citation format.
 */

import { embedQuery } from "@/lib/retrieval/retrieve";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type RetrievalSourceType = "DEAL_DOC" | "BANK_POLICY" | "SBA_POLICY";

export type RetrievalResult = {
  content: string;
  source_type: RetrievalSourceType;
  citation: {
    chunk_id: string;
    source_id: string; // upload_id, asset_id, or rule_id
    doc_name?: string;
    page_num?: number;
    rule_key?: string; // For SBA policies
  };
  similarity: number;
};

export type RetrieveContextParams = {
  dealId: string;
  bankId?: string;
  query: string;
  sources?: RetrievalSourceType[];
  topK?: number;
};

/**
 * Unified retrieval across all knowledge sources
 */
export async function retrieveContext({
  dealId,
  bankId,
  query,
  sources = ["DEAL_DOC", "BANK_POLICY", "SBA_POLICY"],
  topK = 20,
}: RetrieveContextParams): Promise<RetrievalResult[]> {
  // 1. Embed query once
  const embedding = await embedQuery(query);
  const sb = supabaseAdmin();

  // 2. Parallel retrieval from all sources
  const results = await Promise.all([
    // Deal documents
    sources.includes("DEAL_DOC")
      ? retrieveDealDocs(sb, dealId, embedding, Math.ceil(topK * 0.5))
      : Promise.resolve([]),

    // Bank policies
    sources.includes("BANK_POLICY") && bankId
      ? retrieveBankPolicies(sb, bankId, embedding, Math.ceil(topK * 0.25))
      : Promise.resolve([]),

    // SBA policies
    sources.includes("SBA_POLICY")
      ? retrieveSBAPolicies(sb, embedding, Math.ceil(topK * 0.25))
      : Promise.resolve([]),
  ]);

  // 3. Combine and sort by similarity
  const combined = results.flat();
  combined.sort((a, b) => b.similarity - a.similarity);

  // 4. Return top K
  return combined.slice(0, topK);
}

/**
 * Retrieve from deal documents
 */
async function retrieveDealDocs(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  embedding: number[],
  k: number
): Promise<RetrievalResult[]> {
  const { data, error } = await sb.rpc("match_deal_doc_chunks", {
    p_deal_id: dealId,
    query_embedding: embedding,
    match_count: k,
  });

  if (error) {
    console.error("retrieveDealDocs error:", error);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    content: row.chunk_text,
    source_type: "DEAL_DOC" as const,
    citation: {
      chunk_id: row.chunk_id,
      source_id: row.upload_id,
      doc_name: row.doc_name,
      page_num: row.page_num,
    },
    similarity: row.similarity,
  }));
}

/**
 * Retrieve from bank policies
 */
async function retrieveBankPolicies(
  sb: ReturnType<typeof supabaseAdmin>,
  bankId: string,
  embedding: number[],
  k: number
): Promise<RetrievalResult[]> {
  const { data, error } = await sb.rpc("match_bank_policy_chunks", {
    p_bank_id: bankId,
    query_embedding: embedding,
    match_count: k,
  });

  if (error) {
    console.error("retrieveBankPolicies error:", error);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    content: row.chunk_text,
    source_type: "BANK_POLICY" as const,
    citation: {
      chunk_id: row.chunk_id,
      source_id: row.asset_id,
      doc_name: row.doc_name,
    },
    similarity: row.similarity,
  }));
}

/**
 * Retrieve from SBA policies (hybrid: vector + rule matching)
 */
async function retrieveSBAPolicies(
  sb: ReturnType<typeof supabaseAdmin>,
  embedding: number[],
  k: number
): Promise<RetrievalResult[]> {
  // TODO: Once sba_policy_chunks table exists with embeddings,
  // use semantic search similar to bank policies.
  // For now, return structured rules based on keyword matching.

  // Placeholder: Return empty until sba_policy_chunks is populated
  // In production, this would call match_sba_policy_chunks RPC
  return [];
}

/**
 * Helper: Build prompt context from results
 */
export function formatRetrievalContext(results: RetrievalResult[]): string {
  return results
    .map((r, i) => {
      const citation =
        r.source_type === "DEAL_DOC"
          ? `[${i + 1}] ${r.citation.doc_name} (Page ${r.citation.page_num})`
          : r.source_type === "BANK_POLICY"
            ? `[${i + 1}] Bank Policy: ${r.citation.doc_name}`
            : `[${i + 1}] SBA Rule: ${r.citation.rule_key}`;

      return `${citation}\n${r.content}\n`;
    })
    .join("\n---\n\n");
}

/**
 * Helper: Extract citation objects for storage
 */
export function extractCitations(results: RetrievalResult[]) {
  return results.map((r, i) => ({
    citation_index: i + 1,
    source_kind: r.source_type,
    source_id: r.citation.source_id,
    chunk_id: r.citation.chunk_id,
    page_num: r.citation.page_num ?? null,
    quote: r.content.slice(0, 500),
    similarity: r.similarity,
  }));
}
