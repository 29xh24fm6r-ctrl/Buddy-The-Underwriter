// GET /api/deals/[dealId]/memo-inputs
//
// Returns the full Memo Input Package including current readiness. Used by
// the Memo Inputs page to render every section in one round-trip.

import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);

    const result = await buildMemoInputPackage({
      dealId,
      runReconciliation: true,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status: result.reason === "tenant_mismatch" ? 403 : 500 },
      );
    }

    return NextResponse.json({ ok: true, package: result.package });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
