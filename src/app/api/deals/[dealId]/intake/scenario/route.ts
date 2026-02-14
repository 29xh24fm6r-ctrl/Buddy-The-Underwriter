import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// GET /api/deals/:dealId/intake/scenario — Read intake scenario
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  ctx: RouteContext,
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data, error } = await (sb as any)
    .from("deal_intake_scenario")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, scenario: data ?? null });
}

// ---------------------------------------------------------------------------
// PUT /api/deals/:dealId/intake/scenario — Upsert scenario + regenerate slots
// ---------------------------------------------------------------------------

const VALID_STAGES = new Set(["EXISTING", "STARTUP", "ACQUISITION"]);

export async function PUT(
  req: NextRequest,
  ctx: RouteContext,
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const body = await req.json();

  const productType = body?.product_type;
  if (!productType || typeof productType !== "string") {
    return NextResponse.json(
      { ok: false, error: "product_type is required" },
      { status: 400 },
    );
  }

  const stage = body?.borrower_business_stage ?? "EXISTING";
  if (!VALID_STAGES.has(stage)) {
    return NextResponse.json(
      { ok: false, error: "Invalid borrower_business_stage" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Upsert scenario
  const scenarioRow = {
    deal_id: dealId,
    bank_id: bankId,
    product_type: productType,
    borrower_business_stage: stage,
    has_business_tax_returns: body?.has_business_tax_returns ?? true,
    has_financial_statements: body?.has_financial_statements ?? true,
    has_projections: body?.has_projections ?? false,
    entity_age_months: body?.entity_age_months ?? null,
  };

  const { error: upsertErr } = await (sb as any)
    .from("deal_intake_scenario")
    .upsert(scenarioRow, { onConflict: "deal_id" });

  if (upsertErr) {
    return NextResponse.json(
      { ok: false, error: upsertErr.message },
      { status: 500 },
    );
  }

  // Regenerate slots for this scenario
  let slotsResult: { ok: boolean; slotsUpserted: number; error?: string } = {
    ok: false,
    slotsUpserted: 0,
  };

  try {
    const { ensureDeterministicSlotsForScenario } = await import(
      "@/lib/intake/slots/ensureDeterministicSlots"
    );
    slotsResult = await ensureDeterministicSlotsForScenario({ dealId, bankId });
  } catch (e: any) {
    console.error("[intake/scenario] slot regen failed", e);
    slotsResult = { ok: false, slotsUpserted: 0, error: e?.message };
  }

  return NextResponse.json({
    ok: true,
    scenario: scenarioRow,
    slots: {
      ok: slotsResult.ok,
      count: slotsResult.slotsUpserted,
      error: slotsResult.error,
    },
  });
}
