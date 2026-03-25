import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { resolveFinancialReviewItem } from "@/lib/financialReview/resolveFinancialReviewItem";
import type { ResolutionAction } from "@/lib/financialReview/validateResolutionInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type Ctx = { params: Promise<{ dealId: string }> };

const VALID_ACTIONS = new Set<ResolutionAction>([
  "confirm_value",
  "choose_source_value",
  "override_value",
  "provide_value",
  "mark_follow_up",
]);

/**
 * POST /api/deals/[dealId]/financial-review/resolve
 *
 * Resolve a financial review item. Validates input, writes resolution,
 * persists audit trail, and returns refresh hints.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}) as any);

    // Basic shape validation
    const gapId = String(body?.gapId ?? "").trim();
    const action = String(body?.action ?? "").trim() as ResolutionAction;

    if (!gapId) {
      return NextResponse.json({ ok: false, error: "missing_gap_id" }, { status: 400 });
    }
    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
    }

    const result = await resolveFinancialReviewItem({
      gapId,
      action,
      factId: body.factId ?? null,
      conflictId: body.conflictId ?? null,
      resolvedValue: body.resolvedValue != null ? Number(body.resolvedValue) : null,
      resolvedPeriodStart: body.resolvedPeriodStart ?? null,
      resolvedPeriodEnd: body.resolvedPeriodEnd ?? null,
      rationale: body.rationale ?? null,
      dealId,
      bankId: auth.bankId,
      actorUserId: auth.userId,
      actorRole: auth.role,
    });

    if (!result.ok) {
      const status = result.error === "forbidden" ? 403
        : result.error === "gap_not_found" ? 404
        : result.error === "validation_failed" ? 422
        : 500;
      return NextResponse.json(result, { status });
    }

    // Indicate to UI what needs refreshing
    const truthChanged = action !== "mark_follow_up";
    return NextResponse.json({
      ...result,
      refresh: {
        gapQueue: true,
        financialSnapshot: truthChanged,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[financial-review/resolve POST]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
