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

const ROUTE = "/api/aegis/recording/stop";

/**
 * POST /api/aegis/recording/stop
 *
 * Stops an active Aegis recording session.
 *
 * Body: { session_id: string }
 *
 * Auth: clerkAuth() via getCurrentBankId()
 */
export async function POST(req: NextRequest) {
  const correlationId = generateCorrelationId("aegis-rx");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const bankId = await getCurrentBankId();

    let body: { session_id?: string };
    try {
      body = await req.json();
    } catch {
      return respond200(
        {
          ok: false,
          error: { code: "invalid_body", message: "JSON body required" },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const sessionId = body.session_id;
    if (!sessionId || typeof sessionId !== "string") {
      return respond200(
        {
          ok: false,
          error: { code: "missing_param", message: "session_id is required" },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("aegis_recording_sessions" as any)
      .update({
        status: "stopped",
        stopped_at: new Date().toISOString(),
      } as any)
      .eq("session_id", sessionId)
      .eq("bank_id", bankId)
      .eq("status", "active")
      .select("session_id, frame_count, finding_count")
      .maybeSingle();

    if (error) {
      return respond200(
        {
          ok: false,
          error: { code: "update_failed", message: error.message },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    if (!data) {
      return respond200(
        {
          ok: false,
          error: {
            code: "not_found",
            message: "Session not found, already stopped, or does not belong to your bank",
          },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    return respond200(
      {
        ok: true,
        session_id: (data as any).session_id,
        frame_count: (data as any).frame_count,
        finding_count: (data as any).finding_count,
        meta: { correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "aegis_recording_stop_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
