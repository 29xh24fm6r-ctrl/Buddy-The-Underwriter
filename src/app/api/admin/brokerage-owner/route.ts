import "server-only";

/**
 * GET /api/admin/brokerage-owner
 *
 * Returns the brokerage owner command center view model built from
 * real operational state. Protected by super_admin role check.
 *
 * Spec: 16B / Spec 18 — Owner/Admin Command Center Route Integration
 */

import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/requireRole";
import { buildBrokerageOwnerCommandCenterFromOperationalState } from "@/lib/admin/buildBrokerageOwnerCommandCenterFromOperationalState";

export async function GET() {
  try {
    await requireRoleApi(["super_admin"]);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 403 },
    );
  }

  try {
    const result =
      await buildBrokerageOwnerCommandCenterFromOperationalState();
    return NextResponse.json({
      ok: true,
      viewModel: result.viewModel,
      dealCount: result.dealCount,
      evaluatedAt: result.evaluatedAt,
    });
  } catch (err) {
    console.error("[GET /api/admin/brokerage-owner] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to build owner command center" },
      { status: 500 },
    );
  }
}
