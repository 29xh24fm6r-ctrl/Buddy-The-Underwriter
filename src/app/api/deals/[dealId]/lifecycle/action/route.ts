import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  requireDealCockpitAccess,
  COCKPIT_ROLES,
} from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { buildFinancialSnapshot } from "@/lib/financials/buildFinancialSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/lifecycle/action
 *
 * Unified endpoint for running lifecycle server actions.
 *
 * Phase 56D fix: uses requireDealCockpitAccess (effective role from
 * Clerk + bank_memberships fallback) instead of requireRoleApi
 * (Clerk-only, causes false role_missing when publicMetadata is stale).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  try {
    const { dealId } = await ctx.params;

    // Phase 56D: unified cockpit auth — resolves role from Clerk OR bank_memberships
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      console.log("[lifecycle/action] cockpit auth result", {
        dealId,
        ok: false,
        error: auth.error,
        detail: (auth as any).detail ?? null,
      });
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail ?? null },
        { status: auth.status }
      );
    }

    console.log("[lifecycle/action] cockpit auth result", {
      dealId,
      ok: true,
      bankId: auth.bankId,
      role: auth.role,
    });

    const body = await req.json();
    const { action } = body;

    if (!action || typeof action !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid action" },
        { status: 400 }
      );
    }

    switch (action) {
      case "generate_snapshot": {
        const result = await buildFinancialSnapshot({
          dealId,
          bankId: auth.bankId,
        });

        if (result.status === "already_present") {
          return NextResponse.json({
            ok: true,
            status: "already_present",
            message: "Financial snapshot already exists",
            snapshotId: result.snapshotId,
          });
        }

        return NextResponse.json({
          ok: true,
          status: "created",
          message: "Financial snapshot generated successfully",
          snapshotId: result.snapshotId,
        });
      }

      case "generate_packet": {
        return NextResponse.json(
          {
            ok: false,
            error: "Committee packet generation not yet implemented",
          },
          { status: 501 }
        );
      }

      case "run_ai_classification": {
        const classifyRes = await fetch(
          `${req.nextUrl.origin}/api/deals/${dealId}/files/classify-all`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: req.headers.get("cookie") || "",
            },
          }
        );

        const classifyData = await classifyRes.json();

        if (!classifyRes.ok || !classifyData.ok) {
          return NextResponse.json(
            {
              ok: false,
              error: classifyData.error || "Classification failed",
            },
            { status: classifyRes.status }
          );
        }

        return NextResponse.json({
          ok: true,
          message: "AI classification started",
          ...classifyData,
        });
      }

      case "send_reminder": {
        return NextResponse.json(
          {
            ok: false,
            error: "Borrower reminder not yet implemented",
          },
          { status: 501 }
        );
      }

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    rethrowNextErrors(error);

    console.error("[/api/deals/[dealId]/lifecycle/action] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 }
    );
  }
}
