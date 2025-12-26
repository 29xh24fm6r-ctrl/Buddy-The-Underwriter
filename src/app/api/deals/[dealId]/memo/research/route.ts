import { NextRequest, NextResponse } from "next/server";
import { runMemoResearch } from "@/lib/intelligence/agents/runMemoResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  entityName?: string;
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
    const { dealId } = await ctx.params;
if (!dealId) {
    return NextResponse.json(
      { ok: false, error: "Missing dealId" },
      { status: 400 },
    );
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const entityName =
    typeof body.entityName === "string" ? body.entityName.trim() : "";
  const research = await runMemoResearch(entityName || `Deal ${dealId}`);

  return NextResponse.json({
    ok: true,
    research: {
      company: research.company ? { summary: research.company } : undefined,
      industry: research.industry ? { summary: research.industry } : undefined,
      owner: research.owner ? { summary: research.owner } : undefined,
      ran_at: new Date().toISOString(),
      sources: research.sources ?? [],
    },
  });
}
