import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set([
  "pending_preview",
  "previewing",
  "claiming",
  "awaiting_borrower_pick",
  "picked",
  "expired",
  "relisted",
]);

export async function GET(req: NextRequest) {
  try {
    await requireRoleApi(["super_admin"]);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    throw e;
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const sb = supabaseAdmin();
  let q = sb
    .from("marketplace_listings")
    .select(
      "id, deal_id, status, sba_program, loan_amount, term_months, score, band, published_rate_bps, matched_lender_bank_ids, preview_opens_at, claim_opens_at, claim_closes_at, picked_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status && ALLOWED_STATUSES.has(status)) {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, listings: data ?? [] });
}
