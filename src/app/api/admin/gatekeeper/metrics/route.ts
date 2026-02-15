import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { computeGatekeeperMetrics } from "@/lib/gatekeeper/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidWorkerSecret(req: NextRequest): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  if (req.headers.get("x-worker-secret") === secret) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("token") === secret) return true;
  return false;
}

/**
 * GET /api/admin/gatekeeper/metrics
 *
 * Returns gatekeeper classification metrics:
 * - total classified, NEEDS_REVIEW rate, by-route/doc-type breakdown
 * - shadow routing divergence (ledger-derived)
 * - inline success/timeout/error counts
 *
 * Auth: requireSuperAdmin() OR WORKER_SECRET
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
