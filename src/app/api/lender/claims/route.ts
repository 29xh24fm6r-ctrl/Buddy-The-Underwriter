import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export async function GET() {
  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("marketplace_lender_claims")
    .select(
      "id, listing_id, deal_id, status, claimed_at, decided_at, decided_reason",
    )
    .eq("lender_bank_id", bankId)
    .order("claimed_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, claims: data ?? [] });
}
