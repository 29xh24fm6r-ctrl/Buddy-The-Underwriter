import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
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
    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;

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

    return NextResponse.json(
      {
        ok: true,
        dealId,
        bankId: access.bankId,
        snapshot,
      },
      { headers: noStoreHeaders() },
    );
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/financial-snapshot]", e);

    // If auth throws, do not leak.
    const msg = String(e?.message ?? "");
    if (msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("forbidden")) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
