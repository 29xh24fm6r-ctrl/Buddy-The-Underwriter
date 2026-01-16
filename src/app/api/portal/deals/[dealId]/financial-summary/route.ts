import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace(/^Bearer\s+/i, "");

    const invite = await requireValidInvite(token);
    const { dealId } = await ctx.params;
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");

    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal?.bank_id) {
      return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
    }

    const snapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId: deal.bank_id });

    // Latest rent roll rows (most recent as_of_date)
    const { data: latestRow } = await sb
      .from("deal_rent_roll_rows")
      .select("as_of_date")
      .eq("deal_id", dealId)
      .order("as_of_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestAsOf = latestRow?.as_of_date ?? null;
    const rentRollRows = latestAsOf
      ? (
          await sb
            .from("deal_rent_roll_rows")
            .select(
              "unit_id, unit_type, sqft, tenant_name, lease_start, lease_end, monthly_rent, annual_rent, market_rent_monthly, occupancy_status, concessions_monthly, notes",
            )
            .eq("deal_id", dealId)
            .eq("as_of_date", latestAsOf)
            .order("unit_id", { ascending: true })
        ).data
      : [];

    return NextResponse.json({
      ok: true,
      dealId,
      snapshot,
      rentRoll: {
        as_of_date: latestAsOf,
        rows: rentRollRows ?? [],
      },
      t12: {
        total_income_ttm: snapshot.total_income_ttm,
        opex_ttm: snapshot.opex_ttm,
        noi_ttm: snapshot.noi_ttm,
      },
      last_updated: snapshot.as_of_date,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
