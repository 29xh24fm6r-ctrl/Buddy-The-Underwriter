import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { classifyMarketplaceError } from "@/lib/brokerage/marketplaceClaimErrors";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ listingId: string }> },
) {
  let bankId: string;
  let userId: string | null = null;
  try {
    bankId = await getCurrentBankId();
    const auth = await clerkAuth();
    userId = auth.userId ?? null;
  } catch {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const { listingId } = await ctx.params;

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("claim_marketplace_listing", {
    p_listing_id: listingId,
    p_lender_bank_id: bankId,
    p_user_id: userId,
  });

  if (error) {
    const { code, status } = classifyMarketplaceError(error.message);
    return NextResponse.json({ ok: false, error: code, detail: error.message }, { status });
  }

  // Form submission posts navigate; JSON callers get JSON.
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ ok: true, claim_id: data });
  }
  return NextResponse.redirect(new URL("/lender/listings", req.url), { status: 303 });
}
