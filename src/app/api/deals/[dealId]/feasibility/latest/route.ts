import "server-only";

// src/app/api/deals/[dealId]/feasibility/latest/route.ts
// Phase God Tier Feasibility — GET latest study (step 12/16).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
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
    .select("*")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[feasibility/latest]", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, study: data ?? null });
}
