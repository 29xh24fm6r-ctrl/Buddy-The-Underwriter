import { NextRequest, NextResponse } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { generatePricingScenarios } from "@/lib/pricing/scenarios/generateScenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();

    const result = await generatePricingScenarios({ dealId, bankId });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      snapshotId: result.snapshotId,
      scenarios: result.scenarios,
    });
  } catch (e: any) {
    console.error("[POST /pricing/scenarios/generate]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
