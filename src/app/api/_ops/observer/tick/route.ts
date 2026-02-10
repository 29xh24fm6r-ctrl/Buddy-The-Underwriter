import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { runObserverTick } from "@/lib/aegis/observerLoop";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/_ops/observer/tick
 *
 * Runs the Aegis observer scan loop.
 * Called by Vercel cron every 5 minutes.
 *
 * Auth: CRON_SECRET (Vercel auto-inject), WORKER_SECRET, or super_admin session.
 */
export async function POST(req: NextRequest) {
  if (!hasValidWorkerSecret(req)) {
    try {
      await requireSuperAdmin();
    } catch {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  try {
    const result = await runObserverTick();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
