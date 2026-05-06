// POST /api/deals/[dealId]/readiness/refresh
//
// Recomputes UnifiedDealReadiness, writes the cached deal_memo_input_readiness
// row, and runs the lifecycle reconciler so the journey rail reflects the
// new state. Idempotent — calling twice with no underlying state change is
// a no-op.

import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { buildUnifiedDealReadiness } from "@/lib/deals/readiness/buildUnifiedDealReadiness";
import { reconcileDealLifecycle } from "@/lib/deals/readiness/reconcileDealLifecycle";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealAccess(dealId);

    const result = await buildUnifiedDealReadiness({
      dealId,
      runReconciliation: true,
    });
    if (!result.ok) {
      const status = result.reason === "tenant_mismatch" ? 403 : 500;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status },
      );
    }

    const reconciled = await reconcileDealLifecycle({
      dealId,
      readiness: result.readiness,
      bankerId: auth.userId,
    });

    return NextResponse.json({
      ok: true,
      readiness: result.readiness,
      reconciled,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[readiness/refresh POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
