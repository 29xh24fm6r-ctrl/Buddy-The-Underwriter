import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { computeGatekeeperMetrics } from "@/lib/gatekeeper/metrics";
import { getWorkerAuthMatch } from "@/lib/auth/hasValidWorkerSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidWorkerSecret(req: NextRequest): boolean {
  const match = getWorkerAuthMatch(req);
  return match.matched && match.tokenType === "worker";
}

/**
 * GET /api/admin/gatekeeper
 *
 * Returns gatekeeper classification metrics:
 * - total classified, NEEDS_REVIEW rate, by-route/doc-type breakdown
 * - shadow routing divergence (ledger-derived)
 * - inline success/timeout/error counts
 *
 * Auth: requireSuperAdmin() OR header-carried WORKER_SECRET
 */
export async function GET(req: NextRequest) {
  if (!hasValidWorkerSecret(req)) {
    try {
      const { requireSuperAdmin } = await import("@/lib/auth/requireAdmin");
      await requireSuperAdmin();
    } catch {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const bankId = url.searchParams.get("bank_id") ?? undefined;
  const metrics = await computeGatekeeperMetrics(bankId);
  return NextResponse.json(metrics);
}
