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

const ROUTE = "/api/aegis/findings/resolve";

/**
 * POST /api/aegis/findings/resolve
 *
 * Manually resolve an Aegis finding (buddy_system_events row).
 *
 * Body: { event_id: string }
 *
 * Auth: clerkAuth() via getCurrentBankId()
 */
export async function POST(req: NextRequest) {
  const correlationId = generateCorrelationId("aegis-r");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const bankId = await getCurrentBankId();
    const { userId } = await clerkAuth();

    let body: { event_id?: string };
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

    const eventId = body.event_id;
    if (!eventId || typeof eventId !== "string") {
      return respond200(
        {
          ok: false,
          error: {
            code: "missing_param",
            message: "event_id is required",
          },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const sb = supabaseAdmin();

    // Bank-scoped: only resolve events belonging to this bank
    const { data, error } = await sb
      .from("buddy_system_events" as any)
      .update({
        resolution_status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: userId ?? "unknown",
        resolution_note: "Manually resolved via companion UI",
      } as any)
      .eq("id", eventId)
      .eq("bank_id", bankId)
      .in("resolution_status", ["open", "retrying"])
      .select("id")
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
            message:
              "Event not found or already resolved (or does not belong to your bank)",
          },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    return respond200(
      {
        ok: true,
        resolved: (data as any).id,
        meta: { correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "aegis_resolve_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
