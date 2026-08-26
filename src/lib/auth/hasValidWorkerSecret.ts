import "server-only";

import { NextRequest } from "next/server";
import { secretEquals } from "@/lib/brokerage/secretEquals";

export type WorkerAuthMatch = {
  matched: boolean;
  method?: "bearer" | "header";
  tokenType?: "worker" | "cron";
};

/**
 * Returns which auth method and token type matched (without exposing secrets).
 * Use for diagnostics and the worker-auth probe endpoint.
 */
export function getWorkerAuthMatch(req: NextRequest): WorkerAuthMatch {
  const workerSecret = process.env.WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  // Must have at least one secret configured
  if (!workerSecret && !cronSecret) return { matched: false };

  // 1 & 2: Authorization: Bearer <token>
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    if (secretEquals(token, workerSecret)) return { matched: true, method: "bearer", tokenType: "worker" };
    if (secretEquals(token, cronSecret)) return { matched: true, method: "bearer", tokenType: "cron" };
  }

  // 3: x-worker-secret header
  const hdr = req.headers.get("x-worker-secret") ?? "";
  if (secretEquals(hdr, workerSecret)) return { matched: true, method: "header", tokenType: "worker" };

  return { matched: false };
}

/**
 * Validates that a request carries a valid worker/cron secret.
 *
 * Accepted credentials (any of):
 *   1. Authorization: Bearer <CRON_SECRET>   — Vercel injects this automatically on cron invocations
 *   2. Authorization: Bearer <WORKER_SECRET>  — external schedulers / manual callers
 *   3. x-worker-secret: <WORKER_SECRET>       — header-based auth
 *
 * Secrets are never accepted in URLs. Query strings are retained by browsers,
 * reverse proxies, hosting logs, and observability systems.
 *
 * At least one of WORKER_SECRET or CRON_SECRET must be set in env.
 */
export function hasValidWorkerSecret(req: NextRequest): boolean {
  return getWorkerAuthMatch(req).matched;
}
