import { NextRequest, NextResponse } from "next/server";
import { retrieveTopChunks } from "@/lib/retrieval/retrieve";
import { committeeAnswer } from "@/lib/retrieval/committee";
import { insertAiEvent, insertAiCitations } from "@/lib/ai/trace";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type Params = Promise<{ dealId: string }>;

export async function POST(req: NextRequest, context: { params: Params }) {
  const { dealId } = await context.params;
  const body = await req.json().catch(() => ({}));

  const sectionKey = String(body?.section_key || "risks").trim();
  const userPrompt = String(body?.prompt || "").trim();

  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });
  if (!sectionKey) return NextResponse.json({ error: "section_key required" }, { status: 400 });

  try {
    // We phrase a question that forces a memo section, but stays grounded.
    const question =
      userPrompt ||
      `Draft the credit memo section "${sectionKey}". Use bullet points, be concise, and include evidence-backed statements with citations.`;

    const retrieved = await retrieveTopChunks({ dealId, question, k: 30 });

    // Reuse the committee pipeline, but we want "memo style" output.
    // We do this by prefixing the question; committeeAnswer already enforces citations + no invention.
    const memoResult = await committeeAnswer({
      dealId,
      question: `[CREDIT MEMO SECTION: ${sectionKey}]\n${question}`,
      retrieved,
      debug: false,
    });

    const aiEventId = await insertAiEvent({
      deal_id: dealId,
      kind: "memo.section",
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o",
      input: { dealId, sectionKey, question },
      output: memoResult,
      meta: { retrieved_k: retrieved.length },
    });

    await insertAiCitations(
      (memoResult.citations || []).map((c) => ({
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
        document_id: c.document_id ?? null,
        page_number: c.page_number ?? null,
        bbox: c.bbox ?? null,
      }))
    );

    // Persist a draft
    const sb = getSupabaseServerClient();
    const { data: draft, error: draftErr } = await sb
      .from("deal_memo_section_drafts")
      .insert({
        deal_id: dealId,
        section_key: sectionKey,
        prompt: question,
        content: memoResult.answer,
        ai_event_id: aiEventId,
      })
      .select("id")
      .single();

    if (draftErr) throw draftErr;

    return NextResponse.json({
      draft_id: draft.id,
      section_key: sectionKey,
      content: memoResult.answer,
      citations: memoResult.citations,
      ai_event_id: aiEventId,
    });
  } catch (e: any) {
    console.error("Memo section API error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
