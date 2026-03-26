import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { applyEvidenceReviewDecision } from "@/lib/review/applyEvidenceReviewDecision";
import type { ReviewDecisionAction, ReviewReasonCategory } from "@/lib/review/evidence-review-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; reviewId: string }> };

const VALID_ACTIONS = new Set<ReviewDecisionAction>(["accept", "partially_accept", "reject", "request_clarification", "waive"]);

/**
 * POST /api/deals/[dealId]/review-queue/[reviewId]
 *
 * Apply a review decision. Auth: Clerk session + deal cockpit access.
 *
 * Body: { action, explanationBorrowerSafe?, explanationInternal?, whatStillNeeded?, requestedClarification?, reasonCategory? }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId, reviewId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as ReviewDecisionAction;

  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: `Invalid action. Must be one of: ${[...VALID_ACTIONS].join(", ")}` },
      { status: 400 },
    );
  }

  // Validate required fields per action
  if ((action === "reject" || action === "request_clarification") && !body.explanationBorrowerSafe) {
    return NextResponse.json(
      { ok: false, error: `${action} requires explanationBorrowerSafe` },
      { status: 400 },
    );
  }
  if (action === "waive" && !body.explanationInternal) {
    return NextResponse.json(
      { ok: false, error: "waive requires explanationInternal rationale" },
      { status: 400 },
    );
  }

  const result = await applyEvidenceReviewDecision({
    reviewId,
    dealId,
    action,
    explanationBorrowerSafe: body.explanationBorrowerSafe ?? undefined,
    explanationInternal: body.explanationInternal ?? undefined,
    whatStillNeeded: body.whatStillNeeded ?? undefined,
    requestedClarification: body.requestedClarification ?? undefined,
    reasonCategory: body.reasonCategory as ReviewReasonCategory | undefined,
    reviewerUserId: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    reviewId: result.reviewId,
    newState: result.newState,
    conditionStatusUpdated: result.conditionStatusUpdated,
  });
}
