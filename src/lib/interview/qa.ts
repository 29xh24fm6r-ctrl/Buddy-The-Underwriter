// src/lib/interview/qa.ts
import { LOAN_KNOWLEDGE, type KnowledgeChunk } from "@/lib/interview/loanKnowledge";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

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
  const apiKey = mustEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_QA_MODEL || "gpt-4o-mini";

  const chunks = selectTopChunks(question, 4);

  const context = chunks
    .map((c) => `### [${c.id}] ${c.title}\n${c.content}`)
    .join("\n\n");

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Buddy, a friendly lending assistant.",
          "You answer borrower questions using ONLY the provided knowledge context.",
          "If the question asks for something not in context, say what you can and recommend speaking with a banker for specifics.",
          "Do NOT promise approval, rates, terms, or timelines.",
          "Keep answers short and clear (max ~10 sentences).",
          "End with the compliance disclaimer sentiment from context.",
        ].join("\n"),
      },
      { role: "user", content: `Question:\n${question}\n\nKnowledge Context:\n${context}` },
    ],
    max_tokens: 450,
    temperature: 0.2,
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`openai_qa_failed:${r.status}:${t}`);
  }

  const data: any = await r.json();
  const answer = data?.choices?.[0]?.message?.content || "";

  return {
    answer: String(answer || "").trim(),
    citations: chunks.map((c) => ({ id: c.id, title: c.title })),
  };
}
