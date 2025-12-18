// src/app/api/deals/[dealId]/bank/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DealBankLinkRow = {
  deal_id: string;
  bank_id: string | null;
};

type BankProfileRow = {
  id: string;
  [key: string]: any;
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;

    if (!dealId) {
      return NextResponse.json({ ok: false, error: "missing_dealId" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    // 1) Find the bank link for the deal (typed to avoid `never`)
    const { data: link, error: e1 } = await supabase
      .from("deal_bank_links")
      .select("deal_id, bank_id")
      .eq("deal_id", dealId)
      .maybeSingle<DealBankLinkRow>();

    if (e1) throw e1;

    const bankId = (link as DealBankLinkRow | null)?.bank_id ?? null;

    if (!bankId) {
      return NextResponse.json({ ok: true, bank_id: null, bank: null });
    }

    // 2) Load the bank profile record
    const { data: bank, error: e2 } = await supabase
      .from("bank_profiles")
      .select("*")
      .eq("id", bankId)
      .maybeSingle<BankProfileRow>();

    if (e2) throw e2;

    return NextResponse.json({ ok: true, bank_id: bankId, bank: bank ?? null });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err ?? "unknown_error") },
      { status: 500 }
    );
  }
}
