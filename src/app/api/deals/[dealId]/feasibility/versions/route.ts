import "server-only";

// src/app/api/deals/[dealId]/feasibility/versions/route.ts
// Phase God Tier Feasibility — GET all versions (step 12/16).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: 403 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_feasibility_studies")
    .select(
      "id, version_number, composite_score, recommendation, confidence_level, market_demand_score, financial_viability_score, operational_readiness_score, location_suitability_score, data_completeness, status, is_franchise, created_at",
    )
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false });

  if (error) {
    console.error("[feasibility/versions]", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, versions: data ?? [] });
}
