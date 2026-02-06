import { NextRequest, NextResponse } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { auth } from "@clerk/nextjs/server";
import { recordPricingDecision } from "@/lib/pricing/scenarios/recordDecision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();

    const { userId } = await auth();

    const body = await req.json().catch(() => ({}));

    const {
      pricing_scenario_id,
      decision,
      rationale,
      risks,
      mitigants,
    } = body;

    // Validate required fields
    if (!pricing_scenario_id || typeof pricing_scenario_id !== "string") {
      return NextResponse.json({ ok: false, error: "pricing_scenario_id required" }, { status: 400 });
    }
    if (!decision || !["APPROVED", "REJECTED", "RESTRUCTURE"].includes(decision)) {
      return NextResponse.json(
        { ok: false, error: "decision must be APPROVED, REJECTED, or RESTRUCTURE" },
        { status: 400 },
      );
    }
    if (!rationale || typeof rationale !== "string" || rationale.trim().length < 10) {
      return NextResponse.json(
        { ok: false, error: "rationale is required (minimum 10 characters)" },
        { status: 400 },
      );
    }

    const result = await recordPricingDecision({
      dealId,
      bankId,
      pricingScenarioId: pricing_scenario_id,
      decision,
      rationale: rationale.trim(),
      risks: Array.isArray(risks) ? risks : undefined,
      mitigants: Array.isArray(mitigants) ? mitigants : undefined,
      decidedBy: userId ?? "system",
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      decisionId: result.decisionId,
      termsId: result.termsId,
    });
  } catch (e: any) {
    console.error("[POST /pricing/decide]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
