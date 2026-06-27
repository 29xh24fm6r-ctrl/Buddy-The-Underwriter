/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 0
 *
 * Conflict ledger: make cross-engine fact disagreement OBSERVABLE.
 *
 * As of the §0 census, ~34 fact slots carry multiple LIVE (non-superseded) rows
 * with conflicting rounded values for the same (deal_id, fact_key, owner_type,
 * fact_period_end), yet `deal_fact_conflicts` was empty — conflict detection
 * never fired across engines. This module:
 *
 *   1. `detectSlotConflicts()` — PURE. Groups candidate rows into slots, finds
 *      slots with >1 distinct live rounded value, and picks a single winner
 *      deterministically per §2.3 (strongest source-quality rank; the hardcoded
 *      golden-run / `hardcode` engine can NEVER win; stable tie-break).
 *   2. `buildConflictLedgerRows()` — PURE. Shapes detected conflicts into
 *      `deal_fact_conflicts` insert rows.
 *
 * The DB I/O (insert conflict rows, supersede losers) lives in the Phase 0
 * backfill script and the future single write path — kept out of this pure
 * module so the resolution logic is unit-testable without Supabase.
 */

import { resolveEngineFromSourceRef, inferSourceQualityRank, type SourceQualityRank } from "@/lib/finengine/provenance";

/** Minimal projection of a `deal_financial_facts` row the ledger reasons over. */
export type FactRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  fact_type: string;
  fact_key: string;
  owner_type: string;
  owner_entity_id: string | null;
  fact_period_end: string;
  fact_value_num: number | null;
  is_superseded: boolean;
  source_canonical_type: string | null;
  created_at: string;
  provenance: { source_ref?: string; engine?: string; source_quality_rank?: number; confidence?: number | null } | null;
};

/** Rounding used to decide whether two live values genuinely disagree. */
const VALUE_ROUND_DP = 2;
function roundValue(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** VALUE_ROUND_DP;
  return Math.round(v * f) / f;
}

function slotKey(r: FactRow): string {
  return [r.deal_id, r.fact_key, r.owner_type, r.fact_period_end].join("|");
}

/** Resolve the effective source-quality rank for a row (provenance or inferred). */
export function rowRank(r: FactRow): SourceQualityRank {
  const explicit = r.provenance?.source_quality_rank;
  if (explicit && explicit >= 1 && explicit <= 7) return explicit as SourceQualityRank;
  return inferSourceQualityRank({
    sourceCanonicalType: r.source_canonical_type,
    sourceRef: r.provenance?.source_ref,
    confidence: r.provenance?.confidence ?? null,
  });
}

function rowEngine(r: FactRow): string {
  return r.provenance?.engine ?? resolveEngineFromSourceRef(r.provenance?.source_ref);
}

/**
 * Deterministic winner among the live rows of a slot, per §2.3 / decision D3:
 *   - the `hardcode` engine (golden-run) is NEVER eligible to win;
 *   - otherwise strongest source-quality rank (lower number) wins;
 *   - tie-break: most recent `created_at`, then lexicographically smallest id.
 * Returns null only when there is no eligible (non-hardcode) row.
 */
export function pickWinner(rows: FactRow[]): FactRow | null {
  const eligible = rows.filter((r) => rowEngine(r) !== "hardcode" && r.fact_value_num != null);
  const pool = eligible.length > 0 ? eligible : [];
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const ra = rowRank(a);
    const rb = rowRank(b);
    if (ra !== rb) return ra - rb; // stronger (smaller) first
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1; // newer first
    return a.id < b.id ? -1 : 1; // stable
  })[0];
}

export type SlotConflict = {
  dealId: string;
  bankId: string;
  factType: string;
  factKey: string;
  ownerType: string;
  ownerEntityId: string | null;
  factPeriodEnd: string;
  /** All live row ids participating in the conflict. */
  liveFactIds: string[];
  /** Per-row value/source detail for the ledger. */
  candidates: Array<{
    id: string;
    value: number | null;
    sourceRef: string | null;
    engine: string;
    rank: SourceQualityRank;
  }>;
  /** Winning row id (null when only a hardcode row was present). */
  winnerId: string | null;
  /** Row ids to mark superseded (all live rows except the winner). */
  loserIds: string[];
  resolution: "auto_source_rank" | "unresolved_no_eligible";
};

/**
 * PURE. Detect conflicting slots among the supplied rows. A slot conflicts when
 * its live rows hold >1 distinct rounded value. Hardcode-only disagreements
 * (e.g. golden-run vs nothing eligible) are still recorded but marked
 * `unresolved_no_eligible`.
 */
export function detectSlotConflicts(rows: FactRow[]): SlotConflict[] {
  const bySlot = new Map<string, FactRow[]>();
  for (const r of rows) {
    if (r.is_superseded) continue;
    const k = slotKey(r);
    const arr = bySlot.get(k) ?? [];
    arr.push(r);
    bySlot.set(k, arr);
  }

  const conflicts: SlotConflict[] = [];
  for (const live of bySlot.values()) {
    const distinct = new Set(
      live.map((r) => roundValue(r.fact_value_num)).filter((v): v is number => v != null),
    );
    if (distinct.size <= 1) continue; // unique or single live value — no conflict

    const winner = pickWinner(live);
    const head = live[0];
    conflicts.push({
      dealId: head.deal_id,
      bankId: head.bank_id,
      factType: head.fact_type,
      factKey: head.fact_key,
      ownerType: head.owner_type,
      ownerEntityId: head.owner_entity_id,
      factPeriodEnd: head.fact_period_end,
      liveFactIds: live.map((r) => r.id),
      candidates: live.map((r) => ({
        id: r.id,
        value: r.fact_value_num,
        sourceRef: r.provenance?.source_ref ?? null,
        engine: rowEngine(r),
        rank: rowRank(r),
      })),
      winnerId: winner?.id ?? null,
      loserIds: live.filter((r) => r.id !== winner?.id).map((r) => r.id),
      resolution: winner ? "auto_source_rank" : "unresolved_no_eligible",
    });
  }
  return conflicts;
}

/** A row shaped for insertion into `deal_fact_conflicts`. */
export type ConflictLedgerRow = {
  deal_id: string;
  bank_id: string;
  fact_type: string;
  fact_key: string;
  owner_entity_id: string | null;
  conflicting_fact_ids: string[];
  conflicting_values: unknown;
  conflict_type: string;
  status: string;
  resolved_fact_id: string | null;
  resolved_by: string | null;
  resolution: string | null;
  resolved_value: unknown;
};

/** PURE. Shape detected conflicts into `deal_fact_conflicts` insert rows. */
export function buildConflictLedgerRows(conflicts: SlotConflict[]): ConflictLedgerRow[] {
  return conflicts.map((c) => {
    const winner = c.candidates.find((x) => x.id === c.winnerId) ?? null;
    return {
      deal_id: c.dealId,
      bank_id: c.bankId,
      fact_type: c.factType,
      fact_key: c.factKey,
      owner_entity_id: c.ownerEntityId,
      conflicting_fact_ids: c.liveFactIds,
      conflicting_values: c.candidates,
      conflict_type: "cross_engine_value_mismatch",
      status: c.winnerId ? "resolved" : "open",
      resolved_fact_id: c.winnerId,
      resolved_by: c.winnerId ? "finengine.phase0.source_rank" : null,
      resolution: c.resolution,
      resolved_value: winner ? { id: winner.id, value: winner.value, source_ref: winner.sourceRef, engine: winner.engine, rank: winner.rank } : null,
    };
  });
}
