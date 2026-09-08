/**
 * Readiness reconcile sweep.
 *
 * `deal_memo_input_readiness` is a cache of derived state, rewritten only by
 * event hooks (`refreshDealReadiness`). If a hook fails once — a worker with
 * no session, a platform timeout, a crash between the authoritative write and
 * the refresh — the row lags the state it summarizes and nothing ever brings
 * it back. Observed 2026-09-08 on deal c0f6caab: a research mission reached a
 * passing gate at 17:12 UTC, the completion hook was refused as
 * tenant_mismatch, and the row kept `missing_research_quality_gate` from
 * 17:11 until a banker happened to open a page that recomputes it.
 *
 * This sweep runs on the worker tick and closes that gap: any readiness row
 * older than the newest authoritative write it depends on (research quality
 * gate, financial snapshot, spread render, financial fact) is refreshed with
 * a service-verified deal/bank grant. Bounded per tick; never throws.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccessForService } from "@/lib/tenant/ensureDealBankAccess";
import { refreshDealReadiness } from "./refreshDealReadiness";

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_DEALS_PER_SWEEP = 3;
/** Writes landing within this window of the row's evaluation are the same event. */
const STALE_GRACE_MS = 5_000;

export type ReadinessRowLite = {
  deal_id: string;
  bank_id: string | null;
  evaluated_at: string | null;
};

export type AuthoritativeWrite = {
  deal_id: string;
  at: string;
  source: "research_gate" | "financial_snapshot" | "spread" | "financial_fact";
};

export type StaleReadinessDeal = {
  dealId: string;
  bankId: string | null;
  evaluatedAt: string | null;
  newestWriteAt: string;
  newestWriteSource: AuthoritativeWrite["source"];
};

/**
 * Pure selection: a readiness row is stale when an authoritative write for its
 * deal is newer than the row's `evaluated_at` (plus a small grace window so a
 * write and the refresh it triggered are not mistaken for drift). Deals with
 * authoritative writes but no readiness row at all are left alone — they
 * have never been evaluated and are not this sweep's concern.
 */
export function selectStaleReadiness(
  rows: ReadonlyArray<ReadinessRowLite>,
  writes: ReadonlyArray<AuthoritativeWrite>,
  graceMs: number = STALE_GRACE_MS,
): StaleReadinessDeal[] {
  const newest = new Map<string, AuthoritativeWrite>();
  for (const w of writes) {
    const t = Date.parse(w.at);
    if (!Number.isFinite(t)) continue;
    const prev = newest.get(w.deal_id);
    if (!prev || t > Date.parse(prev.at)) newest.set(w.deal_id, w);
  }

  const stale: StaleReadinessDeal[] = [];
  for (const row of rows) {
    const w = newest.get(row.deal_id);
    if (!w) continue;
    const evaluatedMs = row.evaluated_at ? Date.parse(row.evaluated_at) : Number.NEGATIVE_INFINITY;
    if (Date.parse(w.at) > evaluatedMs + graceMs) {
      stale.push({
        dealId: row.deal_id,
        bankId: row.bank_id,
        evaluatedAt: row.evaluated_at,
        newestWriteAt: w.at,
        newestWriteSource: w.source,
      });
    }
  }
  // Oldest rows first so a persistently stale deal is not starved by newer ones.
  stale.sort((a, b) => {
    const ea = a.evaluatedAt ? Date.parse(a.evaluatedAt) : Number.NEGATIVE_INFINITY;
    const eb = b.evaluatedAt ? Date.parse(b.evaluatedAt) : Number.NEGATIVE_INFINITY;
    return ea - eb;
  });
  return stale;
}

export type ReadinessReconcileSweepResult = {
  ok: boolean;
  stale_found: number;
  reconciled: number;
  deals: string[];
  errors: string[];
};

async function loadRecentAuthoritativeWrites(
  sb: ReturnType<typeof supabaseAdmin>,
  sinceIso: string,
): Promise<AuthoritativeWrite[]> {
  const writes: AuthoritativeWrite[] = [];
  const sources: Array<{
    table: string;
    column: string;
    source: AuthoritativeWrite["source"];
  }> = [
    { table: "buddy_research_quality_gates", column: "evaluated_at", source: "research_gate" },
    { table: "financial_snapshots", column: "created_at", source: "financial_snapshot" },
    { table: "deal_spreads", column: "updated_at", source: "spread" },
    { table: "deal_financial_facts", column: "created_at", source: "financial_fact" },
  ];
  for (const s of sources) {
    const { data, error } = await (sb as any)
      .from(s.table)
      .select(`deal_id, ${s.column}`)
      .gte(s.column, sinceIso)
      .order(s.column, { ascending: false })
      .limit(500);
    if (error) throw new Error(`${s.table}: ${error.message}`);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const dealId = typeof r.deal_id === "string" ? r.deal_id : null;
      const at = typeof r[s.column] === "string" ? (r[s.column] as string) : null;
      if (dealId && at) writes.push({ deal_id: dealId, at, source: s.source });
    }
  }
  return writes;
}

/**
 * Refresh readiness rows that lag their authoritative inputs. Runs from the
 * worker tick; each refresh carries a service grant because there is no
 * session in a cron context. Never throws.
 */
export async function sweepStaleDealReadiness(opts?: {
  lookbackMs?: number;
  maxDeals?: number;
}): Promise<ReadinessReconcileSweepResult> {
  const sb = supabaseAdmin();
  const lookbackMs = opts?.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const maxDeals = Math.max(1, opts?.maxDeals ?? DEFAULT_MAX_DEALS_PER_SWEEP);
  const sinceIso = new Date(Date.now() - lookbackMs).toISOString();
  const errors: string[] = [];

  let writes: AuthoritativeWrite[];
  try {
    writes = await loadRecentAuthoritativeWrites(sb, sinceIso);
  } catch (e: any) {
    return { ok: false, stale_found: 0, reconciled: 0, deals: [], errors: [e?.message ?? "authoritative_writes_failed"] };
  }
  if (writes.length === 0) {
    return { ok: true, stale_found: 0, reconciled: 0, deals: [], errors: [] };
  }

  const dealIds = Array.from(new Set(writes.map((w) => w.deal_id)));
  const { data: rows, error: rowsError } = await (sb as any)
    .from("deal_memo_input_readiness")
    .select("deal_id, bank_id, evaluated_at")
    .in("deal_id", dealIds);
  if (rowsError) {
    return { ok: false, stale_found: 0, reconciled: 0, deals: [], errors: [`deal_memo_input_readiness: ${rowsError.message}`] };
  }

  const stale = selectStaleReadiness((rows ?? []) as ReadinessRowLite[], writes);
  if (stale.length === 0) {
    return { ok: true, stale_found: 0, reconciled: 0, deals: [], errors: [] };
  }

  let reconciled = 0;
  const deals: string[] = [];
  for (const target of stale.slice(0, maxDeals)) {
    try {
      let bankId = target.bankId;
      if (!bankId) {
        const { data: deal } = await (sb as any)
          .from("deals")
          .select("bank_id")
          .eq("id", target.dealId)
          .maybeSingle();
        bankId = (deal as { bank_id?: string | null } | null)?.bank_id ?? null;
      }
      if (!bankId) {
        errors.push(`${target.dealId}: no bank_id`);
        continue;
      }
      const access = await ensureDealBankAccessForService(target.dealId, bankId);
      if (!access.ok) {
        errors.push(`${target.dealId}: ${access.error}`);
        continue;
      }
      const result = await refreshDealReadiness({
        dealId: target.dealId,
        trigger: "reconcile_sweep",
        actorId: "system:readiness_reconcile",
        accessGrant: access.grant,
      });
      if (!result.ok) {
        errors.push(`${target.dealId}: ${result.reason}`);
        continue;
      }
      reconciled += 1;
      deals.push(target.dealId);
      console.log("[readinessReconcileSweep] refreshed", {
        dealId: target.dealId,
        evaluatedAt: target.evaluatedAt,
        newestWriteAt: target.newestWriteAt,
        newestWriteSource: target.newestWriteSource,
      });
    } catch (e: any) {
      errors.push(`${target.dealId}: ${e?.message ?? String(e)}`);
    }
  }

  return { ok: errors.length === 0, stale_found: stale.length, reconciled, deals, errors };
}
