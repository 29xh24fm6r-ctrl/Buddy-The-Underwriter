/**
 * Buddy Ledger Visibility Tools — read-only, observer-only.
 *
 * Queries buddy_ledger_events (already ingested by Pulse forwarder).
 * Never throws. Returns { summary, artifacts } shape.
 */

import { supabaseAdmin } from "../../supabase";

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampLimit(raw: number | undefined, defaultVal: number, min: number, max: number): number {
  const v = raw ?? defaultVal;
  return Math.max(min, Math.min(max, v));
}

// ─── Types ──────────────────────────────────────────────────────────────────

type LedgerEvent = {
  trace_id: string;
  created_at: string;
  deal_id: string;
  bank_id: string;
  env: string;
  event_key: string;
  payload: object;
};

// ─── buddy_list_ledger_events ───────────────────────────────────────────────

export async function buddy_list_ledger_events(args: {
  deal_id?: string;
  bank_id?: string;
  event_key?: string;
  env?: string;
  after?: string;
  before?: string;
  limit?: number;
}): Promise<{ summary: string; artifacts: LedgerEvent[] }> {
  try {
    const limit = clampLimit(args.limit, 50, 1, 200);

    let q = supabaseAdmin
      .from("buddy_ledger_events")
      .select("trace_id, created_at, deal_id, bank_id, env, event_key, payload")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (args.deal_id) q = q.eq("deal_id", args.deal_id);
    if (args.bank_id) q = q.eq("bank_id", args.bank_id);
    if (args.event_key) q = q.eq("event_key", args.event_key);
    if (args.env) q = q.eq("env", args.env);
    if (args.after) q = q.gte("created_at", args.after);
    if (args.before) q = q.lte("created_at", args.before);

    const { data, error } = await q;

    if (error) {
      return {
        summary: `Query failed: ${error.message}`,
        artifacts: [],
      };
    }

    const events = (data ?? []) as LedgerEvent[];
    return {
      summary: `Found ${events.length} ledger event(s)`,
      artifacts: events,
    };
  } catch (err: any) {
    return {
      summary: `Error: ${err?.message ?? "unknown"}`,
      artifacts: [],
    };
  }
}

// ─── buddy_get_deal_ledger ──────────────────────────────────────────────────

export async function buddy_get_deal_ledger(args: {
  deal_id?: string;
  event_keys?: string[];
  env?: string;
}): Promise<{
  summary: string;
  artifacts: Array<{
    deal_id: string;
    total_events: number;
    first_event: string | null;
    last_event: string | null;
    event_key_counts: Record<string, number>;
    events: LedgerEvent[];
  }>;
}> {
  try {
    if (!args.deal_id) {
      return {
        summary: "Missing required parameter: deal_id",
        artifacts: [],
      };
    }

    let q = supabaseAdmin
      .from("buddy_ledger_events")
      .select("trace_id, created_at, deal_id, bank_id, env, event_key, payload")
      .eq("deal_id", args.deal_id)
      .order("created_at", { ascending: true })
      .limit(2000);

    if (args.env) q = q.eq("env", args.env);
    if (args.event_keys && args.event_keys.length > 0) {
      q = q.in("event_key", args.event_keys);
    }

    const { data, error } = await q;

    if (error) {
      return {
        summary: `Query failed: ${error.message}`,
        artifacts: [],
      };
    }

    const events = (data ?? []) as LedgerEvent[];

    // Compute summary statistics
    const eventKeyCounts: Record<string, number> = {};
    for (const ev of events) {
      eventKeyCounts[ev.event_key] = (eventKeyCounts[ev.event_key] ?? 0) + 1;
    }

    const firstEvent = events.length > 0 ? events[0].created_at : null;
    const lastEvent = events.length > 0 ? events[events.length - 1].created_at : null;

    return {
      summary: `Deal ${args.deal_id}: ${events.length} ledger event(s)`,
      artifacts: [
        {
          deal_id: args.deal_id,
          total_events: events.length,
          first_event: firstEvent,
          last_event: lastEvent,
          event_key_counts: eventKeyCounts,
          events,
        },
      ],
    };
  } catch (err: any) {
    return {
      summary: `Error: ${err?.message ?? "unknown"}`,
      artifacts: [],
    };
  }
}
