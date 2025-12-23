import { NextResponse } from "next/server";
import { runAIPilot } from "@/lib/ai/orchestrator";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userIntent = String(body?.userIntent ?? "").trim();
    const dealId = body?.dealId ? String(body.dealId) : null;

    if (!userIntent) {
      return NextResponse.json(
        { error: "Missing userIntent" },
        { status: 400 }
      );
    }

    // TODO: Replace with real deal/doc context fetch (db)
    const context = body?.context ?? {
      app: "Buddy The Underwriter",
      note: "Demo context only. Wire real data next.",
    };

    const result = await runAIPilot({ userIntent, dealId, context });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
