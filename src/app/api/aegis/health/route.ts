import "server-only";

import { NextRequest } from "next/server";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ROUTE = "/api/aegis/health";

/**
 * GET /api/aegis/health
 *
 * Returns Aegis health severity for a deal (or bank-wide).
 * Reads from buddy_system_events — open/retrying events in last 24h.
 *
 * Query params:
 *   deal_id (optional) — scope to a specific deal
 *   session_id (optional) — include recording session status
 *
 * Auth: clerkAuth() via getCurrentBankId()
 */
export async function GET(req: NextRequest) {
  const correlationId = generateCorrelationId("aegis-h");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const bankId = await getCurrentBankId();

    const url = new URL(req.url);
    const dealId = url.searchParams.get("deal_id");
    const sessionId = url.searchParams.get("session_id");

    const sb = supabaseAdmin();
    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();

    // Count open/retrying events by severity
    let query = sb
      .from("buddy_system_events" as any)
      .select("severity")
      .eq("bank_id", bankId)
      .in("event_type", [
        "error",
        "warning",
        "suppressed",
        "stuck_job",
        "lease_expired",
      ])
      .in("resolution_status", ["open", "retrying"])
      .gte("created_at", twentyFourHoursAgo);

    if (dealId) {
      query = query.eq("deal_id", dealId);
    }

    const { data: events, error } = await query;

    if (error) {
      return respond200(
        {
          ok: false,
          error: { code: "query_failed", message: error.message },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const counts = { critical: 0, error: 0, warning: 0, suppressed: 0 };
    for (const evt of (events ?? []) as any[]) {
      const sev = evt.severity as string;
      if (sev === "critical") counts.critical++;
      else if (sev === "error") counts.error++;
      else if (sev === "warning") counts.warning++;
    }

    // Count suppressed events separately
    const suppressed = (events ?? []).filter(
      (e: any) => e.severity === "warning" || e.severity === "error",
    );
    // We already counted them; just track suppressed event_type count
    counts.suppressed = (events ?? []).length - counts.critical - counts.error - counts.warning;

    let severity: "ok" | "degraded" | "alert" = "ok";
    if (counts.critical > 0 || counts.error >= 3) {
      severity = "alert";
    } else if (counts.error > 0 || counts.warning >= 3) {
      severity = "degraded";
    }

    // Optional: recording session status
    let recording: { active: boolean; session_id: string | null; frames: number } | null = null;
    if (sessionId) {
      const { data: session } = await sb
        .from("aegis_recording_sessions" as any)
        .select("session_id, status, frame_count")
        .eq("session_id", sessionId)
        .eq("bank_id", bankId)
        .maybeSingle();

      if (session) {
        recording = {
          active: (session as any).status === "active",
          session_id: (session as any).session_id,
          frames: (session as any).frame_count ?? 0,
        };
      }
    }

    return respond200(
      {
        ok: true,
        asOf: ts,
        domain: dealId ? "deal" : "bank",
        severity,
        counts,
        ...(recording ? { recording } : {}),
        meta: { correlationId, ts, dealId },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "aegis_health_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
