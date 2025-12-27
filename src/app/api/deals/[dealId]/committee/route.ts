import { NextRequest, NextResponse } from "next/server";
import { retrieveTopChunks } from "@/lib/retrieval/retrieve";
import { committeeAnswer } from "@/lib/retrieval/committee";

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

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("Committee API error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}
