import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { generateSBAPackage } from "@/lib/sba/sbaPackageOrchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = Promise<{ dealId: string }>;

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

async function ensureSbaDealOrReturn403(dealId: string): Promise<Response | null> {
  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("deal_type")
    .eq("id", dealId)
    .single();
  if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
    return NextResponse.json(
      { error: "SBA Package is not available for this deal type." },
      { status: 403 },
    );
  }
  return null;
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sbaGate = await ensureSbaDealOrReturn403(dealId);
    if (sbaGate) return sbaGate;

    const result = await generateSBAPackage(dealId);

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
