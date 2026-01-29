/**
 * GET /api/pulse/forward-ledger/health
 *
 * Returns operational health of the Pulse ledger forwarder:
 * - backlog_unforwarded: rows not yet forwarded (excludes deadletter)
 * - backlog_claimed: rows currently claimed by a worker
 * - deadlettered: rows that exhausted retry attempts
 * - failed_last_hour: rows with >0 attempts in the last hour
 * - max_attempts_seen: highest attempt count on any pending row
 *
 * Emits a degraded signal if thresholds are breached.
 *
 * Auth: Bearer PULSE_FORWARDER_TOKEN.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { emitObserverEvent } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKLOG_THRESHOLD = 500;
const FAILED_HOUR_THRESHOLD = 25;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = process.env.PULSE_FORWARDER_TOKEN;
  if (!token) return false;
  return auth === `Bearer ${token}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Run all health queries in parallel
  const [unforwardedRes, claimedRes, deadletteredRes, failedHourRes, maxAttemptsRes] =
    await Promise.all([
      // Unforwarded (excludes deadlettered)
      sb
        .from("deal_pipeline_ledger")
        .select("*", { count: "exact", head: true })
        .is("pulse_forwarded_at", null)
        .is("pulse_forward_deadletter_at", null),

      // Currently claimed
      sb
        .from("deal_pipeline_ledger")
        .select("*", { count: "exact", head: true })
        .not("pulse_forward_claimed_at", "is", null)
        .is("pulse_forwarded_at", null),

      // Deadlettered
      sb
        .from("deal_pipeline_ledger")
        .select("*", { count: "exact", head: true })
        .not("pulse_forward_deadletter_at", "is", null),

      // Failed in last hour
      sb
        .from("deal_pipeline_ledger")
        .select("*", { count: "exact", head: true })
        .is("pulse_forwarded_at", null)
        .gt("pulse_forward_attempts", 0)
        .gte("created_at", oneHourAgo),

      // Max attempts on any pending row
      sb
        .from("deal_pipeline_ledger")
        .select("pulse_forward_attempts")
        .is("pulse_forwarded_at", null)
        .not("pulse_forward_attempts", "is", null)
        .order("pulse_forward_attempts", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const health = {
    ok: true,
    backlog_unforwarded: unforwardedRes.count ?? 0,
    backlog_claimed: claimedRes.count ?? 0,
    deadlettered: deadletteredRes.count ?? 0,
    failed_last_hour: failedHourRes.count ?? 0,
    max_attempts_seen: (maxAttemptsRes.data as any)?.pulse_forward_attempts ?? 0,
  };

  // Emit degraded signal if thresholds breached
  const isDegraded =
    health.backlog_unforwarded > BACKLOG_THRESHOLD ||
    health.failed_last_hour > FAILED_HOUR_THRESHOLD ||
    health.deadlettered > 0;

  if (isDegraded) {
    // fire-and-forget — never block health response
    emitObserverEvent({
      severity: "warn",
      type: "service.error",
      stage: "pulse.forwarder",
      message: "Pulse forwarder degraded",
      context: {
        backlog_unforwarded: health.backlog_unforwarded,
        backlog_claimed: health.backlog_claimed,
        deadlettered: health.deadlettered,
        failed_last_hour: health.failed_last_hour,
        max_attempts_seen: health.max_attempts_seen,
      },
    }).catch(() => {});
  }

  return NextResponse.json(health);
}
