import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveLifecycleState } from "@/buddy/lifecycle";
import { writeEvent } from "@/lib/ledger/writeEvent";
import type { LifecycleStage } from "@/buddy/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

const VALID_STAGES: LifecycleStage[] = [
  "intake_created",
  "docs_requested",
  "docs_in_progress",
  "docs_satisfied",
  "underwrite_ready",
  "underwrite_in_progress",
  "committee_ready",
  "committee_decisioned",
  "closing_in_progress",
  "closed",
  "workout",
];

// Map unified stages to underlying deals.lifecycle_stage values
const UNIFIED_TO_UNDERLYING: Record<string, string> = {
  intake_created: "created",
  docs_requested: "intake",
  docs_in_progress: "collecting",
  docs_satisfied: "collecting",
  underwrite_ready: "collecting",
  underwrite_in_progress: "underwriting",
  committee_ready: "ready",
  committee_decisioned: "ready",
  closing_in_progress: "ready",
  closed: "ready",
  workout: "workout",
};

const BodySchema = z.object({
  targetStage: z.enum(VALID_STAGES as [LifecycleStage, ...LifecycleStage[]]),
  reason: z.string().min(5, "Reason must be at least 5 characters").max(500),
  skipBlockers: z.boolean().optional().default(true),
});

/**
 * POST /api/deals/[dealId]/lifecycle/force-advance
 *
 * Banker-accessible force advance endpoint.
 * This is intentionally separate from the general advance endpoint
 * to provide bankers with override capability while maintaining audit trails.
 *
 * Request body:
 * - targetStage: LifecycleStage - The stage to advance to
 * - reason: string - Required explanation for the override
 * - skipBlockers: boolean - Whether to skip blocker checks (default: true)
 *
 * Returns:
 * - ok: true, state: LifecycleState - Successfully force-advanced
 * - ok: false, error: string - Failed
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  try {
    const { userId, role } = await requireRole([
      "super_admin",
      "bank_admin",
      "underwriter",
    ]);
    const { dealId } = await ctx.params;

    // Verify deal access
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    // Parse and validate request body
    let body: z.infer<typeof BodySchema>;
    try {
      const raw = await req.json();
      body = BodySchema.parse(raw);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: "Invalid request", details: e?.message },
        { status: 400 }
      );
    }

    const { targetStage, reason, skipBlockers } = body;

    // Get current state for comparison
    const currentState = await deriveLifecycleState(dealId);
    const currentStage = currentState?.stage || "unknown";

    // Determine underlying lifecycle_stage value
    const underlyingStage = UNIFIED_TO_UNDERLYING[targetStage] || "collecting";

    const sb = supabaseAdmin();

    // Write audit event BEFORE making the change
    await writeEvent({
      dealId,
      kind: "deal.lifecycle.force_advanced",
      actorUserId: userId,
      scope: "banker_override",
      action: "force_advance",
      input: {
        fromStage: currentStage,
        toStage: targetStage,
        underlyingStage,
        reason,
        skipBlockers,
        role,
        timestamp: new Date().toISOString(),
      },
      requiresHumanReview: false,
    });

    // Update the underlying deals.lifecycle_stage
    const { error: updateError } = await sb
      .from("deals")
      .update({
        lifecycle_stage: underlyingStage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dealId)
      .eq("bank_id", access.bankId);

    if (updateError) {
      console.error("[lifecycle/force-advance] Update failed:", updateError);
      return NextResponse.json(
        { ok: false, error: "Failed to update deal", details: updateError.message },
        { status: 500 }
      );
    }

    // For certain stages, also update deal_status for borrower-facing view
    const borrowerStageMap: Record<string, string> = {
      docs_in_progress: "docs_in_progress",
      docs_satisfied: "analysis",
      underwrite_ready: "analysis",
      underwrite_in_progress: "underwriting",
      committee_ready: "conditional_approval",
      committee_decisioned: "conditional_approval",
      closing_in_progress: "closing",
      closed: "funded",
    };

    const borrowerStage = borrowerStageMap[targetStage];
    if (borrowerStage) {
      await sb
        .from("deal_status")
        .upsert(
          {
            deal_id: dealId,
            stage: borrowerStage,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "deal_id" }
        )
        .eq("deal_id", dealId);
    }

    // Fetch new state
    const newState = await deriveLifecycleState(dealId);

    console.info("[lifecycle/force-advance] SUCCESS", {
      dealId,
      userId,
      role,
      fromStage: currentStage,
      toStage: targetStage,
      underlyingStage,
      reason,
    });

    return NextResponse.json({
      ok: true,
      advanced: true,
      fromStage: currentStage,
      toStage: targetStage,
      state: newState,
      message: `Deal force-advanced to ${targetStage}`,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/lifecycle/force-advance] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "internal_error" },
      { status: 500 }
    );
  }
}
