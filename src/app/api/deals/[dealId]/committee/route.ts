import { NextRequest, NextResponse } from "next/server";
import { retrieveTopChunks } from "@/lib/retrieval/retrieve";
import { committeeAnswer } from "@/lib/retrieval/committee";
import { insertAiEvent, insertAiCitations } from "@/lib/ai/trace";

type Params = Promise<{ dealId: string }>;

export async function POST(req: NextRequest, context: { params: Params }) {
  const { dealId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const question = String(body?.question || "").trim();
  const debug = Boolean(body?.debug);

  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });

  try {
    const retrieved = await retrieveTopChunks({ dealId, question, k: 20 });
    const result = await committeeAnswer({ dealId, question, retrieved, debug });

    // Persist ai_event + citations for traceability
    const aiEventId = await insertAiEvent({
      deal_id: dealId,
      kind: "committee.answer",
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o",
      input: { question, dealId },
      output: result,
      meta: { retrieved_k: retrieved.length },
    });

    await insertAiCitations(
      (result.citations || []).map((c) => ({
        ai_event_id: aiEventId,
        deal_id: dealId,
        bank_id: null,
        source_kind: "deal_doc_chunk" as const,
        chunk_id: c.chunk_id,
        upload_id: c.upload_id || null,
        excerpt: c.snippet,
        similarity: typeof c.similarity === "number" ? c.similarity : null,
        page_start: c.page_start ?? null,
        page_end: c.page_end ?? null,
        document_id: (c as any).document_id ?? null,
        page_number: (c as any).page_number ?? null,
        bbox: (c as any).bbox ?? null,
      }))
    );

    return NextResponse.json({ ...result, ai_event_id: aiEventId });
  } catch (e: any) {
    console.error("Committee API error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
