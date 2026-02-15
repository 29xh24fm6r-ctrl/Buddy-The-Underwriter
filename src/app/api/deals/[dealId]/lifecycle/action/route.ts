import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { buildFinancialSnapshot } from "@/lib/financials/buildFinancialSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/lifecycle/action
 *
 * Unified endpoint for running lifecycle server actions.
 * Accepts an action type in the request body and routes to the appropriate handler.
 *
 * Supported actions:
 * - generate_snapshot: Generate financial snapshot
 * - generate_packet: Generate committee packet
 * - run_ai_classification: Run AI classification on documents
 * - send_reminder: Send borrower reminder
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    // Verify deal access
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    // Parse action from request body
    const body = await req.json();
    const { action } = body;

    if (!action || typeof action !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid action" },
        { status: 400 }
      );
    }

    // Route to appropriate action handler
    switch (action) {
      case "generate_snapshot": {
        const result = await buildFinancialSnapshot({
          dealId,
          bankId: access.bankId,
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
        // TODO: Implement committee packet generation
        return NextResponse.json({
          ok: false,
          error: "Committee packet generation not yet implemented",
        }, { status: 501 });
      }

      case "run_ai_classification": {
        // Trigger AI classification for all unclassified documents
        const classifyRes = await fetch(
          `${req.nextUrl.origin}/api/deals/${dealId}/files/classify-all`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Forward auth cookies
              Cookie: req.headers.get("cookie") || "",
            },
          }
        );

        const classifyData = await classifyRes.json();

        if (!classifyRes.ok || !classifyData.ok) {
          return NextResponse.json({
            ok: false,
            error: classifyData.error || "Classification failed",
          }, { status: classifyRes.status });
        }

        return NextResponse.json({
          ok: true,
          message: "AI classification started",
          ...classifyData,
        });
      }

      case "send_reminder": {
        // TODO: Implement borrower reminder
        return NextResponse.json({
          ok: false,
          error: "Borrower reminder not yet implemented",
        }, { status: 501 });
      }

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/lifecycle/action] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 }
    );
  }
}
