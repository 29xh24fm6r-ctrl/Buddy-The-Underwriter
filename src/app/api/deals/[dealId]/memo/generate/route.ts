import { NextRequest, NextResponse } from "next/server";
import { getOpenAI } from "@/lib/ai/openaiClient";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveDealChunks } from "@/lib/retrieval/deal";
import { retrieveBankPolicyChunks } from "@/lib/retrieval/policy";

type Params = Promise<{ dealId: string }>;

const SECTIONS = [
  { key: "EXEC_SUMMARY", title: "Executive Summary" },
  { key: "BUSINESS_OVERVIEW", title: "Business Overview" },
  { key: "CASH_FLOW", title: "Cash Flow & Repayment" },
  { key: "COLLATERAL", title: "Collateral" },
  { key: "RISKS_MITIGANTS", title: "Key Risks & Mitigants" },
  { key: "COVENANTS", title: "Covenants / Policy Fit" },
  { key: "RECOMMENDATION", title: "Recommendation" },
];

export async function POST(req: NextRequest, context: { params: Params }) {
  const { dealId } = await context.params;
  const { bankId } = (await req.json().catch(() => ({}))) as { bankId?: string };

  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });

  try {
    const openai = getOpenAI();
    const sb = getSupabaseServerClient();
    const model = "gpt-4o-mini";

    const results: Array<{ key: string; title: string; text: string; citations: any[] }> = [];

    for (const s of SECTIONS) {
      const emb = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: `Write the memo section: ${s.title}.`,
      });
      const q = emb.data[0]?.embedding ?? [];
      
      const deal = await retrieveDealChunks({ dealId, queryEmbedding: q, k: 10 });
      const policy = bankId ? await retrieveBankPolicyChunks({ bankId, queryEmbedding: q, k: 6 }) : [];

      const evidence = [
        ...deal.map((c) => ({
          source_kind: "DEAL_DOC",
          source_id: c.upload_id,
          chunk_id: c.chunk_id,
          page_start: c.page_start ?? null,
          page_end: c.page_end ?? null,
          page_num: null,
          asset_id: null,
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
          quote: c.content.slice(0, 600),
          text: `[BANK_POLICY asset=${c.asset_id ?? "?"} page=${c.page_num ?? "?"} section=${c.section ?? ""}] ${c.content}`,
        })),
      ];

      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write credit memos. Output JSON only with section_text and citations by evidence index. No fluff. Cite all claims.",
          },
          {
            role: "user",
            content: JSON.stringify({
              section: s.title,
              evidence: evidence.map((e, i) => ({ i, text: e.text })),
              output_schema: { section_text: "string", citations: [{ i: "number", reason: "string" }] },
            }),
          },
        ],
      });

      const out = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
      results.push({ key: s.key, title: s.title, text: out.section_text ?? "", citations: out.citations ?? [] });

      // Store event + citations per section (traceable)
      const { data: eventRow, error: runErr } = await sb
        .from("ai_events")
        .insert({
          deal_id: dealId,
          scope: "memo_generation",
          action: "generate_section",
          input_json: { section_key: s.key, section_title: s.title, bank_id: bankId },
          output_json: out,
          model,
          usage_json: completion.usage ?? {},
          requires_human_review: false,
        })
        .select("id")
        .single();

      if (runErr) {
        console.error("Failed to insert memo section event:", runErr);
        continue;
      }

      const cited = (out.citations ?? []) as { i: number }[];
      const rows = cited
        .map((c) => evidence[c.i])
        .filter(Boolean)
        .map((e) => ({
          event_id: eventRow?.id,
          source_kind: e.source_kind,
          source_id: e.source_id,
          chunk_id: e.chunk_id,
          page_num: e.page_num,
          page_start: e.page_start,
          page_end: e.page_end,
          quote: e.quote,
        }));
      
      if (rows.length && eventRow) {
        const { error: citErr } = await sb.from("ai_event_citations").insert(rows);
        if (citErr) console.error("Failed to insert memo citations:", citErr);
      }
    }

    return NextResponse.json({ ok: true, sections: results });
  } catch (e: any) {
    console.error("Auto-memo API error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
