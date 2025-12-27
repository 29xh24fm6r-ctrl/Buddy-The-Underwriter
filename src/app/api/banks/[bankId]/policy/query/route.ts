import { NextRequest, NextResponse } from "next/server";
import { retrieveBankPolicyChunks } from "@/lib/retrieval/policy";
import { insertAiEvent, insertAiCitations } from "@/lib/ai/trace";
import { getOpenAI, getModel } from "@/lib/ai/openaiClient";

type Params = Promise<{ bankId: string }>;

export async function POST(req: NextRequest, context: { params: Params }) {
  const { bankId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const question = String(body?.question || "").trim();

  if (!bankId) return NextResponse.json({ error: "bankId required" }, { status: 400 });
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });

  try {
    const retrieved = await retrieveBankPolicyChunks({ bankId, question, k: 12 });

    // Answer grounded in policy chunks
    const openai = getOpenAI();
    const model = getModel();
    
    const context = retrieved
      .map((c, i) => `POLICY CHUNK ${i + 1}\nchunk_id: ${c.chunk_id}\nlabel: ${c.source_label}\ntext: ${c.content.replace(/\s+/g, " ").trim()}\n`)
      .join("\n");

    const sys = [
      "You are a bank credit policy assistant.",
      "Answer ONLY from the provided policy chunks.",
      "Return concise answer and include citations with chunk_id and short quote.",
      'Return ONLY JSON: {"answer":"...","citations":[{"chunk_id":"...","quote":"..."}]}',
    ].join("\n");

    const resp = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Question: ${question}\n\n${context}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const text = resp.choices[0]?.message?.content?.trim();
    const json = JSON.parse(text || "{}");

    const aiEventId = await insertAiEvent({
      deal_id: null,
      bank_id: bankId,
      kind: "policy.query",
      model: model,
      input: { bankId, question },
      output: json,
      meta: { retrieved_k: retrieved.length },
    });

    const byId = new Map(retrieved.map((r) => [r.chunk_id, r]));
    await insertAiCitations(
      (json.citations || []).map((c: any) => ({
        ai_event_id: aiEventId,
        deal_id: null,
        bank_id: bankId,
        source_kind: "bank_policy_chunk" as const,
        chunk_id: c.chunk_id,
        upload_id: null,
        excerpt: String(c.quote || ""),
        similarity: byId.get(c.chunk_id)?.similarity ?? null,
        page_start: null,
        page_end: null,
        document_id: null,
        page_number: null,
        bbox: null,
      }))
    );

    return NextResponse.json({ ...json, ai_event_id: aiEventId });
  } catch (e: any) {
    console.error("Policy query API error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
