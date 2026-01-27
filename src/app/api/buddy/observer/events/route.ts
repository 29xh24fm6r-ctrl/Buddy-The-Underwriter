/**
 * Builder Observer: Omega Events Feed
 *
 * GET /api/buddy/observer/events?limit=50&since=...
 *
 * Returns recent omega-related signals from buddy_signal_ledger.
 * Builder mode only.
 */
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
import { canViewDiagnostics } from "@/lib/modes/gates";
import { getBuddyMode } from "@/lib/modes/mode";

export const dynamic = "force-dynamic";

const ROUTE = "/api/buddy/observer/events";

export async function GET(req: NextRequest) {
  const correlationId = generateCorrelationId("obs-e");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const bankId = await getCurrentBankId();
    const mode = getBuddyMode();
    if (!canViewDiagnostics(mode)) {
      return respond200(
        { ok: false, error: { code: "mode_denied", message: "Observer events requires builder_observer mode." }, meta: { correlationId, ts } },
        headers,
      );
    }

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
    const since = url.searchParams.get("since");

    const sb = supabaseAdmin();

    // Fetch omega-related signals
    let q = sb
      .from("buddy_signal_ledger")
      .select("id, created_at, deal_id, type, source, payload")
      .eq("bank_id", bankId)
      .like("type", "omega.%")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (since) q = q.gte("created_at", since);

    const { data, error } = await q;

    if (error) {
      return respond200(
        { ok: false, error: { code: "query_failed", message: error.message }, meta: { correlationId, ts } },
        headers,
      );
    }

    return respond200(
      {
        ok: true,
        events: data ?? [],
        count: data?.length ?? 0,
        meta: { correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "observer_events_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
