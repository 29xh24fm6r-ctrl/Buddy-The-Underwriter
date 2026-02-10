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

const ROUTE = "/api/aegis/findings";

/**
 * GET /api/aegis/findings
 *
 * Returns page-scoped Aegis findings (open/retrying events) for a deal.
 *
 * Query params:
 *   deal_id (required)
 *   limit (optional, default 20, max 50)
 *
 * Auth: clerkAuth() via getCurrentBankId()
 */
export async function GET(req: NextRequest) {
  const correlationId = generateCorrelationId("aegis-f");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const bankId = await getCurrentBankId();

    const url = new URL(req.url);
    const dealId = url.searchParams.get("deal_id");

    if (!dealId) {
      return respond200(
        {
          ok: false,
          error: { code: "missing_param", message: "deal_id is required" },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    let limit = parseInt(url.searchParams.get("limit") || "20", 10);
    limit = Math.min(50, Math.max(1, limit || 20));

    const sb = supabaseAdmin();

    const { data: events, error } = await sb
      .from("buddy_system_events" as any)
      .select(
        "id, created_at, event_type, severity, error_class, error_code, " +
          "error_signature, error_message, source_system, source_job_id, " +
          "source_job_table, resolution_status, resolution_note, " +
          "retry_attempt, max_retries, next_retry_at, payload",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .in("event_type", [
        "error",
        "warning",
        "suppressed",
        "stuck_job",
        "lease_expired",
      ])
      .in("resolution_status", ["open", "retrying"])
      .order("created_at", { ascending: false })
      .limit(limit);

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

    const findings = ((events ?? []) as any[]).map((e) => ({
      id: e.id,
      createdAt: e.created_at,
      eventType: e.event_type,
      severity: e.severity,
      errorClass: e.error_class,
      errorCode: e.error_code,
      errorSignature: e.error_signature,
      errorMessage: e.error_message,
      sourceSystem: e.source_system,
      sourceJobId: e.source_job_id,
      sourceJobTable: e.source_job_table,
      resolutionStatus: e.resolution_status,
      resolutionNote: e.resolution_note,
      retryAttempt: e.retry_attempt,
      maxRetries: e.max_retries,
      nextRetryAt: e.next_retry_at,
      payload: e.payload,
    }));

    return respond200(
      {
        ok: true,
        findings,
        meta: { correlationId, ts, dealId },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "aegis_findings_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
