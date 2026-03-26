import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { applyFinancialFactDecision } from "@/lib/financial/snapshot/applyFinancialFactDecision";
import type { FactDecisionAction } from "@/lib/financial/snapshot/financial-fact-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; factId: string }> };

const VALID_ACTIONS = new Set<FactDecisionAction>([
  "confirm_fact", "select_conflict_source", "adjust_fact", "reject_fact", "mark_follow_up_needed",
]);

/**
 * POST /api/deals/[dealId]/financial-validation/[factId]
 *
 * Apply a banker decision to a financial fact.
 * Auth: Clerk session + deal cockpit access.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId, factId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as FactDecisionAction;

  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: `Invalid action. Must be one of: ${[...VALID_ACTIONS].join(", ")}` },
      { status: 400 },
    );
  }

  if ((action === "adjust_fact" || action === "reject_fact") && !body.rationale) {
    return NextResponse.json(
      { ok: false, error: `${action} requires rationale` },
      { status: 400 },
    );
  }

  const result = await applyFinancialFactDecision({
    factId,
    snapshotId: body.snapshotId,
    dealId,
    action,
    reviewerUserId: auth.userId,
    rationale: body.rationale,
    selectedProvenanceSourceDocumentId: body.selectedProvenanceSourceDocumentId,
    replacementValue: body.replacementValue,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, factId: result.factId, newState: result.newState });
}
