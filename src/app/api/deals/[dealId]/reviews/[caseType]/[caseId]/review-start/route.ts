import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { queueReviewOutputGeneration } from "@/core/reviews/queueReviewOutputGeneration";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import type { ReviewCaseType } from "@/core/reviews/types";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; caseType: string; caseId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId, caseType, caseId } = await ctx.params;

  try {
    await assertDealAccess(dealId);

    let bankId: string;
    try { bankId = await getCurrentBankId(); } catch {
      return NextResponse.json({ ok: false, error: "No bank" }, { status: 403 });
    }

    const sb = supabaseAdmin();
    const caseTable = caseType === "annual_review" ? "deal_annual_review_cases" : "deal_renewal_cases";

    await sb.from(caseTable)
      .update({ status: "under_review" })
      .eq("id", caseId).eq("deal_id", dealId);

    // Mark submitted requirements as under_review
    await sb.from("deal_review_case_requirements")
      .update({ status: "under_review" })
      .eq("case_id", caseId).eq("case_type", caseType).eq("status", "submitted");

    // Queue outputs
    await queueReviewOutputGeneration({ dealId, bankId, caseType: caseType as ReviewCaseType, caseId });

    await sb.from("deal_timeline_events").insert({
      deal_id: dealId, kind: "review_case.review_started",
      title: `${caseType === "annual_review" ? "Annual review" : "Renewal"} review started`,
      visible_to_borrower: false, meta: { case_type: caseType, case_id: caseId, started_by: userId },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json({ ok: false, error: err?.message ?? "internal_error" }, { status: 500 });
  }
}
