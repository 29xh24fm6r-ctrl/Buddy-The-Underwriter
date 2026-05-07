// GET /api/deals/[dealId]/committee-anticipation
//
// Returns the committee anticipation report — likely objections, posture
// grade, positioning recommendation, and follow-up prep questions.

import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { buildCommitteeAnticipation } from "@/lib/creditMemo/committee/buildCommitteeAnticipation";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);

    const result = await buildCommitteeAnticipation({ dealId });
    if (!result.ok) {
      const status = result.reason === "tenant_mismatch" ? 403 : 500;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status },
      );
    }
    return NextResponse.json({ ok: true, report: result.report });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[committee-anticipation GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
