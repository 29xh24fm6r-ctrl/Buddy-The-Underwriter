import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { runObserverTick } from "@/lib/aegis/observerLoop";

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
 * POST /api/_ops/observer/tick
 *
 * Runs the Aegis observer scan loop.
 * Called by Vercel cron every 5 minutes.
 *
 * Auth: WORKER_SECRET (cron) OR requireSuperAdmin()
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
