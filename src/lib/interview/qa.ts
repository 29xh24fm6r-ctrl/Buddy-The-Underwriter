// src/lib/interview/qa.ts
//
// SPEC-M1.1 — migrated onto the AI gateway. Uses the "structurer" role
// purely for its OpenAI-only chain (no Google fallback — this call site
// must stay on OpenAI, matching its original provider-exclusive behavior);
// no responseSchema is passed, so the result is plain prose, same as
// before this migration.
import { LOAN_KNOWLEDGE, type KnowledgeChunk } from "@/lib/interview/loanKnowledge";
import { OPENAI_MINI } from "@/lib/ai/models";
import { runRole } from "@/lib/ai/gateway";

function scoreChunk(chunk: KnowledgeChunk, q: string) {
  const t = (q || "").toLowerCase();
  let score = 0;
  for (const tag of chunk.tags) if (t.includes(tag.toLowerCase())) score += 2;
  if (t.includes(chunk.title.toLowerCase())) score += 3;

  // light keyword matching
  const keywords = ["sba", "7a", "504", "real estate", "cre", "line of credit", "loc", "equipment", "term", "documents", "fees", "timeline", "eligibility"];
  for (const k of keywords) if (t.includes(k)) score += chunk.content.toLowerCase().includes(k) ? 1 : 0;

  return score;
}

function selectTopChunks(question: string, limit = 4): KnowledgeChunk[] {
  const ranked = LOAN_KNOWLEDGE
    .map((c) => ({ c, s: scoreChunk(c, question) }))
    .sort((a, b) => b.s - a.s);

  const top = ranked.filter((x) => x.s > 0).slice(0, limit).map((x) => x.c);

  // always include disclaimer
  const disclaimer = LOAN_KNOWLEDGE.find((c) => c.id === "disclaimer");
  if (disclaimer && !top.some((x) => x.id === disclaimer.id)) top.push(disclaimer);

  return top;
}

export type QaAnswer = {
  answer: string;
  citations: Array<{ id: string; title: string }>;
};

export async function answerBorrowerQuestion(question: string): Promise<QaAnswer> {
  const model = process.env.OPENAI_QA_MODEL || OPENAI_MINI;

  const chunks = selectTopChunks(question, 4);

  const context = chunks
    .map((c) => `### [${c.id}] ${c.title}\n${c.content}`)
    .join("\n\n");

  const result = await runRole("structurer", {
    modelOverride: model,
    temperature: 0.2,
    maxOutputTokens: 450,
    purpose: "borrower_qa",
    systemInstruction: [
      "You are Buddy, a friendly lending assistant.",
      "You answer borrower questions using ONLY the provided knowledge context.",
      "If the question asks for something not in context, say what you can and recommend speaking with a banker for specifics.",
      "Do NOT promise approval, rates, terms, or timelines.",
      "Keep answers short and clear (max ~10 sentences).",
      "End with the compliance disclaimer sentiment from context.",
    ].join("\n"),
    prompt: `Question:\n${question}\n\nKnowledge Context:\n${context}`,
  });

  return {
    answer: result.text.trim(),
    citations: chunks.map((c) => ({ id: c.id, title: c.title })),
  };
}
