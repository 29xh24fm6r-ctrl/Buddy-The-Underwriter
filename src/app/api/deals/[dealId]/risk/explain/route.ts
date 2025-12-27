import { NextRequest, NextResponse } from "next/server";
import { getOpenAI } from "@/lib/ai/openaiClient";
import { retrieveDealChunks } from "@/lib/retrieval/deal";

type Params = Promise<{ dealId: string }>;

export async function POST(req: NextRequest, context: { params: Params }) {
  const { dealId } = await context.params;
  const { headline } = (await req.json().catch(() => ({}))) as { headline: string };

  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });
  if (!headline) return NextResponse.json({ error: "headline required" }, { status: 400 });

  try {
    const openai = getOpenAI();

    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: `Explain and justify this risk/pricing headline: ${headline}`,
    });
    const q = emb.data[0]?.embedding ?? [];
    const deal = await retrieveDealChunks({ dealId, queryEmbedding: q, k: 10 });

    const model = "gpt-4o-mini";
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Output JSON: {explanation, drivers[], counterfactuals[], citations[]} where counterfactuals are concrete changes that would improve outcome.",
        },
        {
          role: "user",
          content: JSON.stringify({
            headline,
            evidence: deal.map((c, i) => ({
              i,
              tag: `upload=${c.upload_id} pages=${c.page_start ?? "?"}-${c.page_end ?? "?"}`,
              text: c.content,
            })),
          }),
        },
      ],
    });

    const out = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    console.error("Explain risk API error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
