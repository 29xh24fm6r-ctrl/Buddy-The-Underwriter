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
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ROUTE = "/api/aegis/recording/start";

/**
 * POST /api/aegis/recording/start
 *
 * Starts a new Aegis recording session.
 *
 * Body: { deal_id?: string }
 *
 * Auth: clerkAuth() via getCurrentBankId()
 */
export async function POST(req: NextRequest) {
  const correlationId = generateCorrelationId("aegis-rs");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const bankId = await getCurrentBankId();
    const { userId } = await clerkAuth();

    let body: { deal_id?: string };
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const sessionId = `aegis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("aegis_recording_sessions" as any)
      .insert({
        session_id: sessionId,
        user_id: userId ?? "unknown",
        bank_id: bankId,
        deal_id: body.deal_id ?? null,
        status: "active",
        started_at: new Date().toISOString(),
      } as any)
      .select("session_id, id")
      .single();

    if (error) {
      return respond200(
        {
          ok: false,
          error: { code: "insert_failed", message: error.message },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    return respond200(
      {
        ok: true,
        session_id: (data as any).session_id,
        id: (data as any).id,
        meta: { correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "aegis_recording_start_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
