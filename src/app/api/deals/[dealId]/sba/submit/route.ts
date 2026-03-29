import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";

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

export async function PATCH(
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

    const sb = supabaseAdmin();

    // Find latest package for this deal
    const { data: latest } = await sb
      .from("buddy_sba_packages")
      .select("id")
      .eq("deal_id", dealId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      return NextResponse.json(
        { ok: false, error: "No package found to submit." },
        { status: 404 },
      );
    }

    const { error } = await sb
      .from("buddy_sba_packages")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
      })
      .eq("id", latest.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
