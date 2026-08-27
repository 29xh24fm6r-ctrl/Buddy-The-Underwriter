// GET /api/deals/[dealId]/committee-anticipation
//
// Returns the committee anticipation report — likely objections, posture
// grade, positioning recommendation, and follow-up prep questions.

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccessAllowingBrokerageStaff } from "@/lib/tenant/ensureDealBankAccess";
import { buildCommitteeAnticipation } from "@/lib/creditMemo/committee/buildCommitteeAnticipation";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const access = await ensureDealBankAccessAllowingBrokerageStaff(dealId);
    if (!access.ok) {
      const status =
        access.error === "unauthorized"
          ? 401
          : access.error === "deal_not_found"
            ? 404
            : 403;
      return NextResponse.json(
        { ok: false, reason: access.error, error: "Unable to load committee anticipation" },
        { status, headers: NO_STORE },
      );
    }

    const result = await buildCommitteeAnticipation({ dealId });
    if (!result.ok) {
      const status = result.reason === "tenant_mismatch" ? 403 : 500;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status, headers: NO_STORE },
      );
    }
    return NextResponse.json({ ok: true, report: result.report }, { headers: NO_STORE });
  } catch (e: unknown) {
    console.error("[committee-anticipation GET]", e);
    return NextResponse.json(
      { ok: false, error: "Unable to load committee anticipation" },
      { status: 500, headers: NO_STORE },
    );
  }
}
