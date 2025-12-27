import { z } from "zod";
import { getOpenAI, getModel } from "@/lib/ai/openaiClient";
import type { RetrievedChunk } from "./types";
import { mapEvidenceChunkRow } from "@/lib/db/rowCase";

const RerankSchema = z.object({
  selected: z
    .array(
      z.object({
        chunkId: z.string(),
        reason: z.string().describe("Why this chunk is relevant to the query"),
      })
    )
    .min(1)
    .max(15)
    .describe("Top chunks that directly answer the query"),
});

type RerankOutput = z.infer<typeof RerankSchema>;

/**
 * AI-powered reranking: take top-N chunks from vector search, use AI to pick the best ones
 * This makes retrieval feel "smart" - not just cosine similarity, but semantic relevance
 * @param args - { query, chunks, topN }
 * @returns { kept: RetrievedChunk[], reasons: { chunkId, reason }[] }
 */
export async function aiRerankChunks(args: {
  query: string;
  chunks: RetrievedChunk[];
  topN?: number;
}): Promise<{ kept: RetrievedChunk[]; reasons: RerankOutput["selected"] }> {
  const topN = args.topN ?? 8;
  const client = getOpenAI();

  // Map chunks to ensure camelCase fields
  const normalized = args.chunks.map(mapEvidenceChunkRow);

  // Use zod-to-json-schema helper (same pattern as other files)
  function jsonSchemaFor(name: string, schema: any) {
    const zodToJsonSchema = require("zod-to-json-schema");
    return {
      name,
      strict: true,
      schema: zodToJsonSchema.zodToJsonSchema(schema, name),
    };
  }

  const payload = {
    QUERY: args.query,
    CHUNKS: normalized.map((c) => ({
      chunkId: c.chunkId!,
      pageStart: c.pageStart!,
      pageEnd: c.pageEnd!,
      similarity: c.similarity,
      content: (c.content || c.text || "").slice(0, 2500), // keep tokens sane
    })),
    INSTRUCTIONS: `Pick the best ${topN} chunks that directly answer the query. Prefer specific numbers, facts, and definitions over generic statements.`,
  };

  const resp = await client.chat.completions.create({
    model: getModel(),
    temperature: 0.1,
    max_tokens: 1200,
    messages: [
      {
        role: "system",
        content:
          "You rerank evidence chunks for underwriting. Return only JSON per schema. Never invent chunkIds.",
      },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: jsonSchemaFor("RerankOutput", RerankSchema),
    },
  });

  const raw = resp.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  const out = RerankSchema.parse(parsed);

  // Filter chunks to only selected ones, preserving order from AI
  const selectedIds = new Set(out.selected.map((s) => s.chunkId));
  const kept = normalized
    .filter((c) => selectedIds.has(c.chunkId!))
    .slice(0, topN);

  return { kept, reasons: out.selected };
}