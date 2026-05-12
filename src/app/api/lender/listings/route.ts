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

  const { data: listings, error } = await sb
    .from("marketplace_listings")
    .select(
      "id, deal_id, status, sba_program, loan_amount, term_months, score, band, published_rate_bps, kfs, kfs_redaction_version, preview_opens_at, claim_opens_at, claim_closes_at",
    )
    .in("status", ["previewing", "claiming", "awaiting_borrower_pick"])
    .contains("matched_lender_bank_ids", [bankId])
    .order("preview_opens_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const { data: claims } = await sb
    .from("marketplace_lender_claims")
    .select("listing_id, status")
    .eq("lender_bank_id", bankId);

  return NextResponse.json({
    ok: true,
    bank_id: bankId,
    listings: listings ?? [],
    my_claims: claims ?? [],
  });
}
