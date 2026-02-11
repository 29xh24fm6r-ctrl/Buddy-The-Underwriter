import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/risk-pricing
 * Returns the current risk pricing model for a deal.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_risk_pricing_model")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: "No risk pricing model exists" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, riskPricing: data });
}

/**
 * POST /api/deals/[dealId]/risk-pricing
 * Trigger risk pricing computation. Requires a financial snapshot to exist.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Params },
) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
  }

  const { computeRiskPricing } = await import("@/buddy/pricing/riskPricingService");
  const result = await computeRiskPricing(dealId);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true, riskPricing: result.data });
}

/**
 * PATCH /api/deals/[dealId]/risk-pricing
 * Apply a banker spread adjustment.
 * Body: { banker_adjustment_bps: number }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Params },
) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
  }

  const body = await req.json();
  const adjustmentBps = body.banker_adjustment_bps;
  if (typeof adjustmentBps !== "number") {
    return NextResponse.json(
      { ok: false, error: "banker_adjustment_bps (number) is required" },
      { status: 400 },
    );
  }

  const { applyBankerAdjustment } = await import("@/buddy/pricing/riskPricingService");
  const result = await applyBankerAdjustment(dealId, adjustmentBps);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true, riskPricing: result.data });
}
