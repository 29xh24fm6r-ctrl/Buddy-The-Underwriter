import "server-only";

/**
 * Phase 65E — Canonical Action Execution Route
 *
 * POST /api/deals/[dealId]/actions/execute
 *
 * Authenticated banker-triggered canonical action execution.
 * The user may only execute actions that Buddy currently derived for the deal.
 */

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { deriveNextActions } from "@/core/actions/deriveNextActions";
import { executeCanonicalAction } from "@/core/actions/execution/executeCanonicalAction";
import type { BuddyActionCode } from "@/core/actions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    // 1. Authenticate + resolve bank/user
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "unauthorized" ? 401 : 403 },
      );
    }

    // 2. Parse request body
    const body = await req.json().catch(() => null);
    const actionCode = body?.actionCode as BuddyActionCode | undefined;
    if (!actionCode || typeof actionCode !== "string") {
      return NextResponse.json(
        { ok: false, error: "missing_action_code" },
        { status: 400 },
      );
    }

    // 3. Derive current canonical state + actions (server-side truth)
    const canonicalState = await getBuddyCanonicalState(dealId);
    const explanation = deriveBuddyExplanation(canonicalState);
    const { nextActions, primaryAction } = deriveNextActions({
      canonicalState,
      explanation,
    });

    // 4. Validate that requested action is currently valid
    const targetAction = nextActions.find((a) => a.code === actionCode);
    if (!targetAction) {
      return NextResponse.json(
        {
          ok: false,
          error: "action_not_available",
          detail: `Action "${actionCode}" is not currently derived for this deal.`,
        },
        { status: 422 },
      );
    }

    // 5. Execute
    const result = await executeCanonicalAction({
      dealId,
      bankId: access.bankId,
      action: targetAction,
      executedBy: access.userId,
      actorType: "banker",
      source: "canonical_action",
    });

    // 6. Recompute state after execution
    const refreshedState = await getBuddyCanonicalState(dealId);
    const refreshedExplanation = deriveBuddyExplanation(refreshedState);
    const refreshedActions = deriveNextActions({
      canonicalState: refreshedState,
      explanation: refreshedExplanation,
    });

    return NextResponse.json({
      ok: true,
      result,
      refreshed: {
        canonicalState: refreshedState,
        explanation: refreshedExplanation,
        nextActions: refreshedActions.nextActions,
        primaryAction: refreshedActions.primaryAction,
      },
    });
  } catch (err) {
    console.error("[POST /api/deals/[dealId]/actions/execute] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal", reason: String(err) },
      { status: 500 },
    );
  }
}
