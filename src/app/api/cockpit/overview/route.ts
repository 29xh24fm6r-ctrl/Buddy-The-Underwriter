import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRoleApi(["super_admin"]);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    throw e;
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const count = (table: string, filter: Record<string, unknown>) =>
    sb.from(table).select("id", { count: "exact", head: true }).match(filter);

  const [drafts, claimed, sealed, previewing, claiming, picked, activeClaims] =
    await Promise.all([
      count("deals", { bank_id: brokerageBankId, origin: "brokerage_anonymous" }),
      count("deals", { bank_id: brokerageBankId, origin: "brokerage_claimed" }),
      sb
        .from("buddy_sealed_packages")
        .select("id", { count: "exact", head: true })
        .is("unsealed_at", null),
      count("marketplace_listings", { status: "previewing" }),
      count("marketplace_listings", { status: "claiming" }),
      count("marketplace_listings", { status: "picked" }),
      count("marketplace_lender_claims", { status: "claimed" }),
    ]);

  return NextResponse.json({
    ok: true,
    brokerage_bank_id: brokerageBankId,
    counts: {
      draft_deals: drafts.count ?? 0,
      claimed_deals: claimed.count ?? 0,
      sealed_packages: sealed.count ?? 0,
      listings_previewing: previewing.count ?? 0,
      listings_claiming: claiming.count ?? 0,
      listings_picked: picked.count ?? 0,
      active_claims: activeClaims.count ?? 0,
    },
  });
}
