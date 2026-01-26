import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { buildFinancialSnapshot } from "@/lib/financials/buildFinancialSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/snapshot/generate
 *
 * One-click CTA to generate a financial snapshot for the deal.
 * Called from LifecycleStatusPanel when user clicks "Generate Snapshot".
 *
 * Returns:
 * - ok: true, status: "created", snapshotId: string - Successfully created
 * - ok: true, status: "already_present" - Snapshot already exists
 * - ok: false, error: string - Error occurred
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    // Verify deal access
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    // Generate the financial snapshot
    const result = await buildFinancialSnapshot({
      dealId,
      bankId: access.bankId,
    });

    if (result.status === "already_present") {
      return NextResponse.json({
        ok: true,
        status: "already_present",
        message: "Financial snapshot already exists",
        snapshotId: result.snapshotId,
      });
    }

    return NextResponse.json({
      ok: true,
      status: "created",
      snapshotId: result.snapshotId,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/snapshot/generate] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 }
    );
  }
}
