/**
 * GET /api/deals/[dealId]/analysis-status
 *
 * Canonical banker analysis status for a deal. The UI consumes this single
 * route — it must never inspect raw analysis tables. Tenant access is
 * enforced via ensureDealBankAccess.
 */

import "server-only";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { getDealAnalysisStatus } from "@/lib/underwriting/getDealAnalysisStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "unauthorized" ? 401 : 404 },
      );
    }

    const status = await getDealAnalysisStatus({
      dealId,
      callerBankId: access.bankId,
    });

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[analysis-status] error", err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
