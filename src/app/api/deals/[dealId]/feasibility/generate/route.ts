import "server-only";

// src/app/api/deals/[dealId]/feasibility/generate/route.ts
// Phase God Tier Feasibility — POST generate endpoint (step 12/16).
// Bank-tenant gated; kicks off the full feasibility pipeline.

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { generateFeasibilityStudy } from "@/lib/feasibility/feasibilityEngine";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

export async function POST(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: 403 },
    );
  }

  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();
  const bankId = (deal as { bank_id?: string } | null)?.bank_id;
  if (!bankId) {
    return NextResponse.json(
      { ok: false, error: "Deal has no bank_id" },
      { status: 400 },
    );
  }

  try {
    const result = await generateFeasibilityStudy({ dealId, bankId });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Feasibility generation failed";
    console.error("[feasibility/generate]", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
