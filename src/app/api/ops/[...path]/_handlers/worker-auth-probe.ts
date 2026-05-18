import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerAuthMatch } from "@/lib/auth/hasValidWorkerSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ops/worker-auth/probe
 *
 * Auth diagnostic endpoint — reports whether the request passes
 * WORKER_SECRET / CRON_SECRET validation and which method matched.
 * Never returns token values.
 */
export async function POST(req: NextRequest) {
  const match = getWorkerAuthMatch(req);
  const env = {
    hasWorkerSecret: !!process.env.WORKER_SECRET,
    hasCronSecret: !!process.env.CRON_SECRET,
  };

  if (match.matched) {
    return NextResponse.json({
      ok: true,
      auth: { method: match.method, tokenType: match.tokenType, matched: true },
      env,
    });
  }

  return NextResponse.json(
    { ok: false, auth: { matched: false }, env },
    { status: 401 },
  );
}
