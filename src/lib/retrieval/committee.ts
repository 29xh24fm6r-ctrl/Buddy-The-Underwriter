import { z } from "zod";
import { getOpenAI, getModel } from "@/lib/ai/openaiClient";
import type { RetrievedChunk, CommitteeAnswer, Citation } from "@/lib/retrieval/types";
import { lookupBestSpanForChunk } from "@/lib/retrieval/spans";
import { assertGroundedCommitteeCitations } from "@/lib/committee/grounding";

const RerankSchema = z.object({
  selected_chunk_ids: z.array(z.string()).min(1).max(8),
  rationale: z.string().optional(),
});

const AnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      chunk_id: z.string(),
      quote: z.string().min(10).max(260),
    })
  ).min(1).max(12),
});

function snippetFromContent(content: string, max = 220) {
  const s = content.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export async function rerankChunks(question: string, retrieved: RetrievedChunk[]) {
  const openai = getOpenAI();
  const model = getModel();

  const candidates = retrieved.slice(0, 20).map((c) => ({
    chunk_id: c.chunk_id,
    similarity: c.similarity,
    content: snippetFromContent(c.content, 420),
  }));

  const prompt = [
    "You are an underwriting committee assistant.",
    "Select the MINIMUM set of chunks (1-8) that best answer the question.",
    "Return only JSON with keys: selected_chunk_ids (array of chunk_id strings).",
    "",
    `Question: ${question}`,
    "",
    "Candidates:",
    ...candidates.map((c, i) => `${i + 1}. id=${c.chunk_id} sim=${c.similarity.toFixed(3)} text="${c.content}"`),
  ].join("\n");

  const resp = await openai.chat.completions.create({
    model: model,
    messages: [
      { role: "system", content: "You are a helpful assistant that returns only valid JSON." },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const text = resp.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty rerank response");

  const json = JSON.parse(text);
  return RerankSchema.parse(json);
}

export async function answerWithCitations(question: string, selected: RetrievedChunk[]) {
  const openai = getOpenAI();
  const model = getModel();

  const context = selected.map((c, idx) => {
    const clean = c.content.replace(/\s+/g, " ").trim();
    return `CHUNK ${idx + 1}\nchunk_id: ${c.chunk_id}\ntext: ${clean}\n`;
  }).join("\n");

  const instructions = [
    "You are an underwriting committee assistant.",
    "Answer using ONLY the provided chunks.",
    "If the chunks do not contain enough info, say what is missing and do not invent facts.",
    "You MUST include citations. Each citation must reference chunk_id and include a short quote taken from that chunk.",
    "Return ONLY valid JSON matching this shape:",
    `{"answer": "...", "citations":[{"chunk_id":"...","quote":"..."}]}`,
  ].join("\n");

  const resp = await openai.chat.completions.create({
    model: model,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: `Question: ${question}\n\n${context}` },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const text = resp.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty answer response");

  const json = JSON.parse(text);
  return AnswerSchema.parse(json);
}

export async function committeeAnswer(opts: {
  dealId: string;
  question: string;
  retrieved: RetrievedChunk[];
  debug?: boolean;
}): Promise<CommitteeAnswer> {
  const { question, retrieved, debug = false } = opts;

  if (!retrieved.length) {
    return {
      answer: "I couldn't find any evidence chunks for this deal yet. Upload documents or add extracted evidence, then retry.",
      citations: [],
      debug: debug ? { retrieved: [], selectedChunkIds: [] } : undefined,
    };
  }

  const reranked = await rerankChunks(question, retrieved);
  const availableIds = new Set(retrieved.map((chunk) => chunk.chunk_id));
  if (
    reranked.selected_chunk_ids.some((chunkId) => !availableIds.has(chunkId))
  ) {
    throw new Error("committee_rerank_invalid_chunk");
  }

  const selectedIds = new Set(reranked.selected_chunk_ids);
  const selected = retrieved
    .filter((chunk) => selectedIds.has(chunk.chunk_id))
    .slice(0, 8);
  if (selected.length === 0) {
    throw new Error("committee_evidence_selection_failed");
  }

  const answered = await answerWithCitations(question, selected);
  assertGroundedCommitteeCitations(
    answered.citations.map((citation) => ({
      source_kind: "deal_doc_chunk" as const,
      chunk_id: citation.chunk_id,
      quote: citation.quote,
    })),
    selected.map((chunk) => ({
      source_kind: "deal_doc_chunk" as const,
      chunk_id: chunk.chunk_id,
      content: chunk.content,
    })),
  );

  const byId = new Map(selected.map((chunk) => [chunk.chunk_id, chunk]));
  
  // Build citations with OCR span lookups (for real doc/page/bbox)
  const citations: Citation[] = [];
  for (const c of answered.citations) {
    const src = byId.get(c.chunk_id);
    if (!src) {
      throw new Error("committee_citation_source_invalid");
    }
    const span = await lookupBestSpanForChunk({
      dealId: opts.dealId,
      chunkId: c.chunk_id,
    }).catch(() => null);

    citations.push({
      chunk_id: c.chunk_id,
      upload_id: span?.upload_id || src.upload_id || "unknown",
      page_start: src?.page_start ?? null,
      page_end: src?.page_end ?? null,
      page_number: span?.page_number ?? null,
      document_id: span?.document_id ?? null,
      bbox: span?.bbox ?? null,
      snippet: c.quote,
      similarity: src?.similarity,
    } as Citation);
  }

  return {
    answer: answered.answer,
    citations,
    debug: debug ? { retrieved, selectedChunkIds: Array.from(selectedIds) } : undefined,
  };
}
