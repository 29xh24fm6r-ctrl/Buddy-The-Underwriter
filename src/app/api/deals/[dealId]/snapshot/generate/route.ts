import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
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
    const { dealId } = await ctx.params;

    // Verify deal access
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    // SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1: before the snapshot decides
    // financial blockers, run the cheap deterministic prerequisite repair so any
    // facts already derivable from accepted upstream data (ANNUAL_DEBT_SERVICE
    // from current pricing, PFS_ANNUAL_DEBT_SERVICE from accepted PFS monthly
    // payments) are materialized first. Anything not source-backed stays missing.
    try {
      const { ensureFinancialReadinessPrerequisites } = await import(
        "@/lib/financialReadiness/ensureFinancialReadinessPrerequisites"
      );
      await ensureFinancialReadinessPrerequisites({
        dealId,
        bankId: access.bankId,
        reason: "financial_snapshot_generate",
        scheduleRefresh: true,
      });
    } catch {
      // Repair is best-effort; snapshot build still fail-closes on missing facts.
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
    rethrowNextErrors(error);

    console.error("[/api/deals/[dealId]/snapshot/generate] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 }
    );
  }
}
