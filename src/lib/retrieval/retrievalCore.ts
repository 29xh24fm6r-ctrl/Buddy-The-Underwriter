/**
 * Retrieval Core - Unified 3-Store Retrieval Engine
 * 
 * Provides citation-grade evidence from:
 * 1. Deal documents (deal_doc_chunks)
 * 2. SBA SOP guidance (sba_sop_chunks)
 * 3. Bank policies (bank_policy_chunks)
 * 
 * Features:
 * - Parallel retrieval across all 3 stores
 * - Cross-encoder reranking for quality
 * - Structured citations ready for UI
 * - Full traceability in ai_events
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================================
// Types
// ============================================================================

export interface RetrievalQuery {
  dealId: string;
  bankId: string;
  program?: "7a" | "504";
  queryText: string;
  topK?: number;
  includeRerank?: boolean;
}

export interface Citation {
  source_kind: "DEAL_DOC" | "SBA_SOP" | "BANK_POLICY";
  chunk_id: string;
  label: string;
  page?: number;
  page_start?: number;
  page_end?: number;
  section?: string;
  quote: string;
  similarity: number;
}

export interface RetrievalResult {
  citations: Citation[];
  evidence_json: {
    retrieval: {
      deal_doc_chunks: any[];
      sba_sop_chunks: any[];
      bank_policy_chunks: any[];
    };
    rerank?: {
      model: string;
      kept: number;
    };
  };
}

// ============================================================================
// Core: Embed Query
// ============================================================================

async function embedQuery(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    dimensions: 1536,
  });
  return response.data[0].embedding;
}

// ============================================================================
// Core: Retrieve from Deal Docs
// ============================================================================

async function retrieveDealDocs(
  dealId: string,
  embedding: number[],
  topK: number
): Promise<any[]> {
  const sb = supabaseAdmin();
  
  const { data, error } = await sb.rpc("match_deal_doc_chunks", {
    in_deal_id: dealId,
    in_query_embedding: embedding,
    in_match_count: topK,
  });

  if (error) {
    console.error("Deal doc retrieval error:", error);
    return [];
  }

  return data || [];
}

// ============================================================================
// Core: Retrieve from SBA SOP
// ============================================================================

async function retrieveSBASOPs(
  program: "7a" | "504" | undefined,
  embedding: number[],
  topK: number
): Promise<any[]> {
  if (!program) return [];
  
  const sb = supabaseAdmin();
  
  const { data, error } = await sb.rpc("match_sba_sop_chunks", {
    in_program: program,
    in_sop_version: null, // Get latest
    in_query_embedding: embedding,
    in_match_count: topK,
  });

  if (error) {
    console.error("SBA SOP retrieval error:", error);
    return [];
  }

  return data || [];
}

// ============================================================================
// Core: Retrieve from Bank Policies
// ============================================================================

async function retrieveBankPolicies(
  bankId: string,
  embedding: number[],
  topK: number
): Promise<any[]> {
  const sb = supabaseAdmin();
  
  const { data, error } = await sb.rpc("match_bank_policy_chunks", {
    in_bank_id: bankId,
    in_query_embedding: embedding,
    in_match_count: topK,
  });

  if (error) {
    console.error("Bank policy retrieval error:", error);
    return [];
  }

  return data || [];
}

// ============================================================================
// Core: Rerank with OpenAI (cross-encoder simulation)
// ============================================================================

async function rerankChunks(
  query: string,
  allChunks: Array<{ content: string; source: any }>,
  topN: number
): Promise<Array<{ source: any; score: number }>> {
  // Simple relevance scoring using OpenAI (cheaper than full cross-encoder)
  // For production: consider Cohere rerank API or local cross-encoder
  
  if (allChunks.length <= topN) {
    return allChunks.map((c) => ({ source: c.source, score: 0.9 }));
  }

  try {
    const prompt = `Rate each chunk's relevance to the query on a scale of 0-10.

Query: ${query}

Chunks:
${allChunks.map((c, i) => `[${i}] ${c.content.slice(0, 200)}...`).join("\n\n")}

Return ONLY a JSON array of scores: [score0, score1, ...]`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    const scoresText = response.choices[0].message.content || "[]";
    const scores = JSON.parse(scoresText.match(/\[[\d,.\s]+\]/)?.[0] || "[]");

    const ranked = allChunks
      .map((c, i) => ({ source: c.source, score: scores[i] || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    return ranked;
  } catch (err) {
    console.error("Rerank error:", err);
    // Fallback: return first N chunks
    return allChunks.slice(0, topN).map((c) => ({ source: c.source, score: 0.5 }));
  }
}

// ============================================================================
// Main: Unified Retrieval
// ============================================================================

export async function retrieveEvidence(
  query: RetrievalQuery
): Promise<RetrievalResult> {
  const { dealId, bankId, program, queryText, topK = 10, includeRerank = true } = query;

  // 1) Embed query
  const embedding = await embedQuery(queryText);

  // 2) Parallel retrieval across all 3 stores
  const [dealDocs, sbaSOPs, bankPolicies] = await Promise.all([
    retrieveDealDocs(dealId, embedding, topK),
    retrieveSBASOPs(program, embedding, topK),
    retrieveBankPolicies(bankId, embedding, topK),
  ]);

  // 3) Combine all chunks for reranking
  const allChunks = [
    ...dealDocs.map((d) => ({ content: d.content, source: { kind: "DEAL_DOC", data: d } })),
    ...sbaSOPs.map((s) => ({ content: s.content, source: { kind: "SBA_SOP", data: s } })),
    ...bankPolicies.map((b) => ({ content: b.content, source: { kind: "BANK_POLICY", data: b } })),
  ];

  // 4) Rerank to pick best evidence
  let finalChunks = allChunks;
  let rerankInfo = undefined;

  if (includeRerank && allChunks.length > topK) {
    const reranked = await rerankChunks(queryText, allChunks, topK);
    finalChunks = reranked.map((r) => r.source);
    rerankInfo = { model: "gpt-4o-mini", kept: reranked.length };
  }

  // 5) Convert to structured citations
  const citations: Citation[] = finalChunks.map((chunk, idx) => {
    const { kind, data } = chunk.source;

    if (kind === "DEAL_DOC") {
      return {
        source_kind: "DEAL_DOC",
        chunk_id: data.chunk_id,
        label: data.source_label || "Deal Document",
        page_start: data.page_start,
        page_end: data.page_end,
        quote: data.content.slice(0, 200),
        similarity: data.similarity,
      };
    } else if (kind === "SBA_SOP") {
      return {
        source_kind: "SBA_SOP",
        chunk_id: data.chunk_id,
        label: `SBA ${data.program.toUpperCase()} SOP`,
        page: data.page_num,
        section: data.section,
        quote: data.content.slice(0, 200),
        similarity: data.similarity,
      };
    } else {
      return {
        source_kind: "BANK_POLICY",
        chunk_id: data.chunk_id,
        label: data.source_label || "Bank Policy",
        page: data.page_num,
        section: data.section,
        quote: data.content.slice(0, 200),
        similarity: data.similarity,
      };
    }
  });

  // 6) Return evidence package
  return {
    citations,
    evidence_json: {
      retrieval: {
        deal_doc_chunks: dealDocs,
        sba_sop_chunks: sbaSOPs,
        bank_policy_chunks: bankPolicies,
      },
      rerank: rerankInfo,
    },
  };
}
