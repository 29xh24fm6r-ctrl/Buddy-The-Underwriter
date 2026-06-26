import "server-only";

export const maxDuration = 15;

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  } as const;
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    // ensureDealBankAccess is the canonical auth + tenant gate for this route.
    // requireRoleApi is redundant here and blocks bankers without Clerk metadata roles.
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      // Do not leak existence across tenants.
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    const snapshot = await buildDealFinancialSnapshotForBank({
      dealId,
      bankId: access.bankId,
    });

    // SPEC-COCKPIT-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-VIEW-1: surface the persisted
    // package status so the cockpit can show an explicit recoverable state when a
    // financial_snapshots row exists but its decision row is missing (orphan), instead
    // of "no review needed yet". Read-only counts; additive to the response.
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const sb = supabaseAdmin();
    const [{ count: snapRowCount }, { count: decisionCount }] = await Promise.all([
      (sb as any)
        .from("financial_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId),
      (sb as any)
        .from("financial_snapshot_decisions")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId),
    ]);

    return NextResponse.json(
      {
        ok: true,
        dealId,
        bankId: access.bankId,
        snapshot,
        canonical_engine: snapshot.canonical_engine ?? null,
        financialPackage: {
          snapshotRowExists: (snapRowCount ?? 0) > 0,
          decisionRowExists: (decisionCount ?? 0) > 0,
        },
      },
      { headers: noStoreHeaders() },
    );
  } catch (e: any) {
    rethrowNextErrors(e);

    console.error("[/api/deals/[dealId]/financial-snapshot]", e);

    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
