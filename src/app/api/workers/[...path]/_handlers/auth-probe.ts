/**
 * GET /api/workers/auth-probe
 *
 * Diagnostic endpoint for worker authentication. Reports which secrets are
 * present in the runtime env (presence only, never values) and which auth
 * method matched the incoming request.
 *
 * Requires a valid worker secret to call — never public. Same gate as other
 * worker endpoints. Unauthenticated requests still get env_presence flags
 * (which an attacker could already infer from 401 vs 200 behavior on any
 * worker call), but no auth-match details.
 *
 * SPEC-WORKER-SECRET-FANOUT-AUTH-1.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  hasValidWorkerSecret,
  getWorkerAuthMatch,
} from "@/lib/auth/hasValidWorkerSecret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  if (!hasValidWorkerSecret(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
        env_presence: {
          CRON_SECRET: Boolean(process.env.CRON_SECRET),
          WORKER_SECRET: Boolean(process.env.WORKER_SECRET),
        },
      },
      { status: 401 },
    );
  }

  const match = getWorkerAuthMatch(req);

  return NextResponse.json({
    ok: true,
    env_presence: {
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
      WORKER_SECRET: Boolean(process.env.WORKER_SECRET),
    },
    auth: {
      matched_method: match.method ?? null,
      matched_token_type: match.tokenType ?? null,
    },
  });
}
