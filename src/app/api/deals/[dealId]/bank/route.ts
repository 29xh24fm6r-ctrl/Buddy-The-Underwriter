// src/app/api/deals/[dealId]/bank/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "missing_dealId" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServerClient();

    // Read bank_id directly from deals table (always exists by FK constraint)
    const { data: deal, error: e1 } = await supabase
      .from("deals")
      .select("bank_id")
      .eq("id", dealId)
      .single();

    if (e1) throw e1;
    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    // Load the bank record (guaranteed to exist by FK)
    const { data: bank, error: e2 } = await supabase
      .from("banks")
      .select("*")
      .eq("id", deal.bank_id)
      .single();

    if (e2) throw e2;

    return NextResponse.json({ ok: true, bank_id: deal.bank_id, bank });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err ?? "unknown_error") },
      { status: 500 },
    );
  }
}
