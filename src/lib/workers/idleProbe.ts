/**
 * Cheap "is there any work?" probe for outbox-driven cron workers.
 *
 * Runs BEFORE opening a claim transaction / FOR UPDATE SKIP LOCKED so the
 * worker can early-return without touching:
 *   - the FOR UPDATE claim path
 *   - heartbeat upserts
 *   - buddy_system_events
 *
 * The query is a single `SELECT id ... LIMIT 1` against buddy_outbox_events
 * with the same filters the claim path uses. Same indexed columns; one row
 * read; no locks; no writes.
 *
 * If the probe itself errors, we fail OPEN (return true) so a transient probe
 * failure cannot mask real work. The downstream claim path is still authoritative.
 */

import { assertServerOnly } from "@/lib/serverOnly";
import type { SupabaseClient } from "@supabase/supabase-js";

assertServerOnly();

const DEFAULT_STALE_WINDOW_MIN = 10;

export type IdleProbeOpts = {
  sb: SupabaseClient<any>;
  /** kinds the worker handles. If omitted, any kind matches. */
  includeKinds?: string[];
  /** kinds the worker explicitly does NOT handle (used by pulse-outbox). */
  excludeKinds?: string[];
  /** stale-claim threshold (minutes). Stale claims count as "available work". */
  staleWindowMin?: number;
};

export async function hasOutboxWork(opts: IdleProbeOpts): Promise<boolean> {
  const { sb, includeKinds, excludeKinds } = opts;
  const stale = new Date(
    Date.now() - (opts.staleWindowMin ?? DEFAULT_STALE_WINDOW_MIN) * 60 * 1000,
  ).toISOString();

  let q: any = (sb as any)
    .from("buddy_outbox_events")
    .select("id")
    .is("delivered_at", null)
    .is("dead_lettered_at", null)
    .or(`claimed_at.is.null,claimed_at.lt.${stale}`);

  if (includeKinds && includeKinds.length === 1) {
    q = q.eq("kind", includeKinds[0]);
  } else if (includeKinds && includeKinds.length > 1) {
    q = q.in("kind", includeKinds);
  }

  if (excludeKinds && excludeKinds.length > 0) {
    q = q.not("kind", "in", `(${excludeKinds.join(",")})`);
  }

  // Apply LIMIT last — `await` on the builder triggers execution.
  const { data, error } = await q.limit(1);
  if (error) {
    // Fail open: the claim path is authoritative; never let a probe error
    // suppress real work.
    return true;
  }
  return Array.isArray(data) && data.length > 0;
}
