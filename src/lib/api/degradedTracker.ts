/**
 * Degraded Response Tracker
 *
 * Tracks when API endpoints return ok:false (degraded but not 500).
 * Helps detect silent reliability regressions that are "papered over" by the Never-500 pattern.
 *
 * Features:
 * - Throttles logging by (dealId + endpoint + code) with 5-minute window
 * - Logs to console in dev, emits buddy signal in prod
 * - Never blocks or throws - tracking is fire-and-forget
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// In-memory throttle cache (cleared on server restart)
const throttleCache = new Map<string, number>();

/**
 * Clean up old throttle entries periodically
 */
function cleanupThrottleCache() {
  const now = Date.now();
  for (const [key, ts] of throttleCache.entries()) {
    if (now - ts > THROTTLE_WINDOW_MS) {
      throttleCache.delete(key);
    }
  }
}

// Run cleanup every 2 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanupThrottleCache, 2 * 60 * 1000);
}

/**
 * Check if we should throttle this degraded event.
 * Returns true if we should skip logging (already logged recently).
 */
function shouldThrottle(key: string): boolean {
  const now = Date.now();
  const lastLogged = throttleCache.get(key);

  if (lastLogged && now - lastLogged < THROTTLE_WINDOW_MS) {
    return true;
  }

  throttleCache.set(key, now);
  return false;
}

export interface DegradedEvent {
  endpoint: string;
  code: string;
  message?: string;
  dealId: string;
  correlationId: string;
  bankId?: string | null;
}

/**
 * Track a degraded API response.
 * Call this when an endpoint returns ok:false.
 *
 * This is fire-and-forget - never throws or blocks.
 */
export async function trackDegradedResponse(event: DegradedEvent): Promise<void> {
  try {
    const throttleKey = `${event.dealId}:${event.endpoint}:${event.code}`;

    if (shouldThrottle(throttleKey)) {
      return;
    }

    // Always log to console for observability
    console.warn("[api.degraded]", {
      endpoint: event.endpoint,
      code: event.code,
      message: event.message?.slice(0, 200),
      dealId: event.dealId,
      correlationId: event.correlationId,
    });

    // In production, write to buddy_signal_ledger for persistence
    if (process.env.NODE_ENV === "production" || process.env.BUDDY_BUILDER_MODE === "1") {
      try {
        const sb = supabaseAdmin();
        await sb.from("buddy_signal_ledger").insert({
          bank_id: event.bankId ?? null,
          deal_id: event.dealId,
          type: "api.degraded",
          source: event.endpoint,
          payload: {
            endpoint: event.endpoint,
            code: event.code,
            message: event.message?.slice(0, 500),
            correlationId: event.correlationId,
            ts: new Date().toISOString(),
          },
        });
      } catch (ledgerErr) {
        console.warn("[api.degraded] ledger write failed (non-fatal)", (ledgerErr as Error)?.message);
      }
    }
  } catch (e) {
    // Never throw from tracking
    console.warn("[api.degraded] tracking failed (non-fatal)", (e as Error)?.message);
  }
}

/**
 * Get recent degraded events for a deal (for Builder UI).
 * Returns up to 20 most recent events from the last hour.
 */
export async function getRecentDegradedEvents(
  dealId: string
): Promise<Array<{ endpoint: string; code: string; correlationId: string; ts: string }>> {
  try {
    const sb = supabaseAdmin();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from("buddy_signal_ledger")
      .select("source, payload, created_at")
      .eq("deal_id", dealId)
      .eq("type", "api.degraded")
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error || !data) return [];

    return data.map((row) => ({
      endpoint: row.source ?? "unknown",
      code: (row.payload as any)?.code ?? "unknown",
      correlationId: (row.payload as any)?.correlationId ?? "unknown",
      ts: row.created_at,
    }));
  } catch {
    return [];
  }
}
