import "server-only";

import { NextRequest } from "next/server";

/**
 * Validates that a request carries a valid worker/cron secret.
 *
 * Accepted credentials (any of):
 *   1. Authorization: Bearer <CRON_SECRET>   — Vercel injects this automatically on cron invocations
 *   2. Authorization: Bearer <WORKER_SECRET>  — external schedulers / manual callers
 *   3. x-worker-secret: <WORKER_SECRET>       — header-based auth
 *   4. ?token=<WORKER_SECRET|CRON_SECRET>      — legacy query-param auth
 *
 * At least one of WORKER_SECRET or CRON_SECRET must be set in env.
 */
export function hasValidWorkerSecret(req: NextRequest): boolean {
  const workerSecret = process.env.WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  // Must have at least one secret configured
  if (!workerSecret && !cronSecret) return false;

  // 1 & 2: Authorization: Bearer <token>
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    if (workerSecret && token === workerSecret) return true;
    if (cronSecret && token === cronSecret) return true;
  }

  // 3: x-worker-secret header
  const hdr = req.headers.get("x-worker-secret") ?? "";
  if (hdr && workerSecret && hdr === workerSecret) return true;

  // 4: ?token= query param
  const url = new URL(req.url);
  const qToken = url.searchParams.get("token") ?? "";
  if (qToken) {
    if (workerSecret && qToken === workerSecret) return true;
    if (cronSecret && qToken === cronSecret) return true;
  }

  return false;
}
