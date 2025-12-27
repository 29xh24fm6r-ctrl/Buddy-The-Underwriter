import { NextRequest, NextResponse } from "next/server";
import { retrieveTopChunks } from "@/lib/retrieval/retrieve";
import { retrieveBankPolicyChunks, blendEvidence } from "@/lib/retrieval/policy";
import { getOpenAI, getModel } from "@/lib/ai/openaiClient";
import { insertAiEvent, insertAiCitations } from "@/lib/ai/trace";

type Params = Promise<{ dealId: string }>;

export async function POST(req: NextRequest, context: { params: Params }) {
  const { dealId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const question = String(body?.question || "").trim();
  const bankId = String(body?.bank_id || "").trim();

  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });
  if (!bankId) return NextResponse.json({ error: "bank_id required for blended mode" }, { status: 400 });

  try {
    const [deal, policy] = await Promise.all([
      retrieveTopChunks({ dealId, question, k: 20 }),
      retrieveBankPolicyChunks({ bankId, question, k: 12 }),
    ]);

    const blended = blendEvidence({ deal, policy, maxDeal: 10, maxPolicy: 8 });

    const openai = getOpenAI();
    const model = getModel();
    
    const ctx = [
      "DEAL EVIDENCE CHUNKS:",
      ...blended.deal.map((c, i) => `DEAL ${i + 1}\nchunk_id: ${c.chunk_id}\ntext: ${c.content.replace(/\s+/g, " ").trim()}\n`),
      "",
      "BANK POLICY CHUNKS:",
      ...blended.policy.map((c, i) => `POLICY ${i + 1}\nchunk_id: ${c.chunk_id}\nlabel: ${c.source_label}\ntext: ${c.content.replace(/\s+/g, " ").trim()}\n`),
    ].join("\n");

    const sys = [
      "You are an underwriting committee assistant.",
      "Answer using ONLY the provided deal evidence and policy chunks.",
      "If policy conflicts with deal evidence, call it out explicitly.",
      "Return ONLY JSON:",
      '{"answer":"...","citations":[{"source_kind":"deal_doc_chunk|bank_policy_chunk","chunk_id":"...","quote":"..."}]}',
    ].join("\n");

    const resp = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Question: ${question}\n\n${ctx}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const text = resp.choices[0]?.message?.content?.trim();
    const json = JSON.parse(text || "{}");

    const aiEventId = await insertAiEvent({
      deal_id: dealId,
      bank_id: bankId,
      kind: "committee.blended",
      model: model,
      input: { dealId, bankId, question },
      output: json,
      meta: { deal_k: deal.length, policy_k: policy.length },
    });

    const dealById = new Map(deal.map((r) => [r.chunk_id, r]));
    const polById = new Map(policy.map((r) => [r.chunk_id, r]));

    await insertAiCitations(
      (json.citations || []).map((c: any) => {
        const kind = String(c.source_kind || "");
        const chunkId = String(c.chunk_id || "");
        const quote = String(c.quote || "");
        if (kind === "bank_policy_chunk") {
          return {
            ai_event_id: aiEventId,
            deal_id: dealId,
            bank_id: bankId,
            source_kind: "bank_policy_chunk" as const,
            chunk_id: chunkId,
            upload_id: null,
            excerpt: quote,
            similarity: polById.get(chunkId)?.similarity ?? null,
            page_start: null,
            page_end: null,
            document_id: null,
            page_number: null,
            bbox: null,
          };
        }
        // default deal_doc_chunk
        const d = dealById.get(chunkId);
        return {
          ai_event_id: aiEventId,
          deal_id: dealId,
          bank_id: bankId,
          source_kind: "deal_doc_chunk" as const,
          chunk_id: chunkId,
          upload_id: d?.upload_id || null,
          excerpt: quote,
          similarity: d?.similarity ?? null,
          page_start: d?.page_start ?? null,
          page_end: d?.page_end ?? null,
          document_id: null,
          page_number: null,
          bbox: null,
        };
      })
    );

    return NextResponse.json({ ...json, ai_event_id: aiEventId });
  } catch (e: any) {
    console.error("Blended committee API error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
