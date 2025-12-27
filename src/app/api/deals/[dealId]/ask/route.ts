import { NextRequest, NextResponse } from "next/server";
import { getOpenAI } from "@/lib/ai/openaiClient";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveDealChunks } from "@/lib/retrieval/deal";
import { retrieveBankPolicyChunks } from "@/lib/retrieval/policy";

type Params = Promise<{ dealId: string }>;

export async function POST(req: NextRequest, context: { params: Params }) {
  const { dealId } = await context.params;
  const body = await req.json().catch(() => ({}));
  
  const question = String(body?.question || "").trim();
  const bankId = body?.bankId ? String(body.bankId) : undefined;
  const k = Number(body?.k ?? 8);

  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });

  try {
    const openai = getOpenAI();
    const sb = getSupabaseServerClient();

    // 1) Embed question (1536)
    const embResp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });
    const q = embResp.data[0]?.embedding ?? [];

    // 2) Retrieve from BOTH stores
    const deal = await retrieveDealChunks({ dealId, queryEmbedding: q, k });
    const policy = bankId
      ? await retrieveBankPolicyChunks({ bankId, queryEmbedding: q, k })
      : [];

    // 3) Compose evidence pack
    const evidence = [
      ...deal.map((c) => ({
        source_kind: "DEAL_DOC",
        source_id: c.upload_id,
        chunk_id: c.chunk_id,
        page_start: c.page_start ?? null,
        page_end: c.page_end ?? null,
        page_num: null,
        asset_id: null,
        section: null,
        quote: c.content.slice(0, 600),
        text: `[DEAL_DOC upload=${c.upload_id} pages=${c.page_start ?? "?"}-${c.page_end ?? "?"}] ${c.content}`,
      })),
      ...policy.map((c) => ({
        source_kind: "BANK_POLICY",
        source_id: c.asset_id ?? "unknown",
        chunk_id: c.chunk_id,
        page_start: null,
        page_end: null,
        page_num: c.page_num ?? null,
        asset_id: c.asset_id ?? null,
        section: c.section ?? null,
        quote: c.content.slice(0, 600),
        text: `[BANK_POLICY asset=${c.asset_id ?? "?"} page=${c.page_num ?? "?"} section=${c.section ?? ""}] ${c.content}`,
      })),
    ];

    // 4) Answer with structured citations
    const model = "gpt-4o-mini";
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are Buddy, an underwriter copilot. Answer precisely. Every claim must cite one or more evidence items by index. Output JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            evidence: evidence.map((e, i) => ({ i, tag: e.text.slice(0, 140), text: e.text })),
            output_schema: {
              answer: "string",
              citations: [{ i: "number", reason: "string" }],
              followups: ["string"],
            },
          }),
        },
      ],
      response_format: { type: "json_object" },
    });

    const out = JSON.parse(completion.choices[0]?.message?.content ?? "{}");

    // 5) Persist event + citations for traceability
    const { data: eventRow, error: rerr } = await sb
      .from("ai_events")
      .insert({
        deal_id: dealId,
        scope: "ask_buddy",
        action: "answer",
        input_json: { question, k, bank_id: bankId },
        output_json: out,
        model,
        usage_json: completion.usage ?? {},
        requires_human_review: false,
      })
      .select("id")
      .single();

    if (rerr) {
      console.error("Failed to insert ai_event:", rerr);
      // Continue anyway - don't fail the request
    }

    if (eventRow) {
      const cited = (out.citations ?? []) as { i: number; reason?: string }[];
      const rows = cited
        .map((c) => evidence[c.i])
        .filter(Boolean)
        .map((e) => ({
          event_id: eventRow.id,
          source_kind: e.source_kind,
          source_id: e.source_id,
          chunk_id: e.chunk_id,
          page_num: e.page_num,
          page_start: e.page_start,
          page_end: e.page_end,
          quote: e.quote,
        }));

      if (rows.length) {
        const { error: citErr } = await sb.from("ai_event_citations").insert(rows);
        if (citErr) console.error("Failed to insert citations:", citErr);
      }
    }

    return NextResponse.json({ ok: true, event_id: eventRow?.id, ...out });
  } catch (e: any) {
    console.error("Ask Buddy API error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
