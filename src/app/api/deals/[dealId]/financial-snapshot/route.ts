import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
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
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

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
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403, headers: noStoreHeaders() },
      );
    }

    console.error("[/api/deals/[dealId]/financial-snapshot]", e);

    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
