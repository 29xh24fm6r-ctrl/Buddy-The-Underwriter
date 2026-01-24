import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { advanceDealLifecycle, forceAdvanceLifecycle } from "@/buddy/lifecycle";
import type { LifecycleStage, ActorContext } from "@/buddy/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/lifecycle/advance
 *
 * Attempts to advance the deal's lifecycle to the next stage.
 *
 * Request body (optional):
 * - force: boolean - Force advance to a specific stage (admin only)
 * - targetStage: LifecycleStage - Required if force=true
 * - reason: string - Required if force=true
 *
 * Returns:
 * - ok: true, advanced: true, state: LifecycleState - Successfully advanced
 * - ok: true, advanced: false, state: LifecycleState, reason: string - No advancement possible
 * - ok: false, error: "blocked", blockers: LifecycleBlocker[], state: LifecycleState - Blocked
 * - ok: false, error: "deal_not_found" - Deal not found
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

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { force, targetStage, reason } = body as {
      force?: boolean;
      targetStage?: LifecycleStage;
      reason?: string;
    };

    // Build actor context
    const actor: ActorContext = {
      type: role === "super_admin" ? "builder" : "banker",
      id: userId,
    };

    let result;

    if (force) {
      // Force advance is DISABLED by default - dangerous for audit/compliance
      // Enable only with LIFECYCLE_ALLOW_FORCE_ADVANCE=1 env var
      const forceAllowed = process.env.LIFECYCLE_ALLOW_FORCE_ADVANCE === "1";
      if (!forceAllowed) {
        return NextResponse.json(
          {
            ok: false,
            error: "forbidden",
            message: "Force advance is disabled. Lifecycle must progress deterministically.",
          },
          { status: 403 }
        );
      }

      // Force advance requires super_admin (builder) role only
      if (role !== "super_admin") {
        return NextResponse.json(
          { ok: false, error: "forbidden", message: "Force advance requires super_admin role" },
          { status: 403 }
        );
      }

      if (!targetStage) {
        return NextResponse.json(
          { ok: false, error: "bad_request", message: "targetStage required for force advance" },
          { status: 400 }
        );
      }

      if (!reason) {
        return NextResponse.json(
          { ok: false, error: "bad_request", message: "reason required for force advance" },
          { status: 400 }
        );
      }

      console.warn(
        `[lifecycle/advance] FORCE ADVANCE by ${userId} (${role}): ${dealId} -> ${targetStage}. Reason: ${reason}`
      );

      result = await forceAdvanceLifecycle(dealId, targetStage, actor, reason);
    } else {
      // Normal advance
      result = await advanceDealLifecycle(dealId, actor);
    }

    // Map result to HTTP response
    if (!result.ok) {
      if (result.error === "deal_not_found") {
        return NextResponse.json(result, { status: 404 });
      }
      // Blocked - return 200 with blockers (not an error, just can't advance)
      return NextResponse.json(result);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[/api/deals/[dealId]/lifecycle/advance] Error:", error);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
