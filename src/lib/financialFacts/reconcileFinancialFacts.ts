/**
 * SPEC-SPREAD-FACT-RECONCILIATION-AND-CONFIDENCE-GATES-1 (PR-522)
 *
 * Pure reconciliation: before facts feed spreads / GCF / NCADS / DSCR / memo metrics,
 * resolve duplicate active facts, quarantine impossible personal-income / tax
 * relationships, and resolve extractor conflicts deterministically. No DB, no deletes —
 * losing facts are EXCLUDED from the selected set and returned as `rejected` with a
 * conflict class + reason so callers can emit ledger/audit events and preserve
 * original provenance.
 */

export type ReconcileFact = {
  id?: string | null;
  fact_key: string;
  fact_period_end: string | null;
  owner_type: string;
  owner_entity_id: string | null;
  source_document_id: string | null;
  source_canonical_type: string | null;
  confidence: number | null;
  extractor: string | null; // provenance.extractor
  fact_value_num: number | null;
};

export type ConflictClass =
  | "duplicate_active_same_key_period_owner"
  | "extractor_conflict"
  | "impossible_personal_income_relationship"
  | "impossible_tax_relationship"
  | "material_zero_fact"
  | "spread_source_conflict";

export type RejectedFact = {
  fact: ReconcileFact;
  conflictClass: ConflictClass;
  reason: string;
};

export type ConfidenceTier = "high" | "medium" | "low" | "blocked";

export type ReconcileResult = {
  selected: ReconcileFact[];
  rejected: RejectedFact[];
  confidenceTier: ConfidenceTier;
  caveats: string[];
  blocked: boolean; // unresolved conflict that must block canonical use (GCF/NCADS preliminary)
  summary: {
    groups: number;
    selectedCount: number;
    rejectedCount: number;
    byClass: Record<ConflictClass, number>;
  };
};

// A value at/above this magnitude is "material"; below MICRO it is "tiny".
const MATERIAL_MIN = 1000;
const MICRO_ABS = 100;
const TINY_RATIO = 0.05; // < 5% of the material sibling is "tiny"

const isMaterial = (v: number | null): v is number => v !== null && Math.abs(v) >= MATERIAL_MIN;

/**
 * Source priority (spec §6). Higher wins. Verified deterministic tax-return identity
 * facts outrank company statements, then high-confidence Gemini, then internally-
 * consistent deterministic, then computed, then interim.
 */
export function sourceRank(f: ReconcileFact): number {
  const ex = (f.extractor ?? "").toLowerCase();
  const sct = (f.source_canonical_type ?? "").toLowerCase();
  const isDeterministic = ex.includes("deterministic");
  const isTaxReturn = ex.includes("taxreturn") || ex.includes("personalincome") || sct.includes("tax_return");
  const isComputed = ex.includes("compute") || ex.includes("aggregator") || ex.includes("template") || ex.includes("backfill");
  const isGemini = ex.includes("gemini");

  if (isTaxReturn && isDeterministic) return 100; // verified tax-return identity
  if (sct.includes("financial_statement") || sct.includes("operating")) return 80; // company full-year
  if (isGemini) return 60;
  if (isDeterministic) return 50; // deterministic (consistency checked separately)
  if (isComputed) return 40;
  return 55; // unknown/other extracted
}

function groupKey(f: ReconcileFact): string {
  return `${f.fact_key}|${f.fact_period_end ?? ""}|${f.owner_type}|${f.owner_entity_id ?? ""}`;
}

function pickWinner(facts: ReconcileFact[]): ReconcileFact {
  return [...facts].sort((a, b) => {
    const r = sourceRank(b) - sourceRank(a);
    if (r !== 0) return r;
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    // prefer the materially larger absolute value (tiny stubs lose)
    return Math.abs(b.fact_value_num ?? 0) - Math.abs(a.fact_value_num ?? 0);
  })[0];
}

const emptyByClass = (): Record<ConflictClass, number> => ({
  duplicate_active_same_key_period_owner: 0,
  extractor_conflict: 0,
  impossible_personal_income_relationship: 0,
  impossible_tax_relationship: 0,
  material_zero_fact: 0,
  spread_source_conflict: 0,
});

export function reconcileFinancialFacts(facts: ReconcileFact[]): ReconcileResult {
  const rejected: RejectedFact[] = [];
  const caveats: string[] = [];
  const reject = (fact: ReconcileFact, conflictClass: ConflictClass, reason: string) =>
    rejected.push({ fact, conflictClass, reason });

  // ── Phase 1: resolve duplicate active facts per (key, period, owner) ──────
  const groups = new Map<string, ReconcileFact[]>();
  for (const f of facts) {
    const k = groupKey(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }

  // Winner per group (after duplicate resolution); keyed by group key.
  const winners = new Map<string, ReconcileFact>();
  for (const [k, group] of groups) {
    if (group.length === 1) {
      winners.set(k, group[0]);
      continue;
    }
    const winner = pickWinner(group);
    winners.set(k, winner);
    const winnerMaterial = isMaterial(winner.fact_value_num);
    for (const loser of group) {
      if (loser === winner) continue;
      const lv = loser.fact_value_num;
      const tiny =
        winnerMaterial &&
        lv !== null &&
        (Math.abs(lv) < MICRO_ABS || Math.abs(lv) < Math.abs(winner.fact_value_num as number) * TINY_RATIO);
      const differentExtractor = (loser.extractor ?? "") !== (winner.extractor ?? "");
      if (tiny) {
        reject(
          loser,
          "duplicate_active_same_key_period_owner",
          `${loser.fact_key} value ${lv} is an implausible stub beside the material ${winner.fact_value_num} (same key/period/owner); excluded.`,
        );
      } else if (differentExtractor && isMaterial(lv) && winnerMaterial && lv !== winner.fact_value_num) {
        reject(
          loser,
          "extractor_conflict",
          `${loser.fact_key} conflict: ${loser.extractor ?? "?"}=${lv} vs ${winner.extractor ?? "?"}=${winner.fact_value_num} (same key/period/owner); higher-priority source selected.`,
        );
      } else {
        reject(
          loser,
          "duplicate_active_same_key_period_owner",
          `Duplicate active ${loser.fact_key} (same key/period/owner); higher-priority source selected.`,
        );
      }
    }
  }

  // ── Phase 2: cross-fact relationship gates per (period, owner) cohort ──────
  const cohortKey = (f: ReconcileFact) => `${f.fact_period_end ?? ""}|${f.owner_type}|${f.owner_entity_id ?? ""}`;
  const cohorts = new Map<string, Map<string, ReconcileFact>>();
  for (const [k, w] of winners) {
    const ck = cohortKey(w);
    if (!cohorts.has(ck)) cohorts.set(ck, new Map());
    cohorts.get(ck)!.set(w.fact_key, w);
  }

  let blocked = false;
  const dropped = new Set<string>(); // group keys whose winner was gate-rejected

  const gateRejectWinner = (w: ReconcileFact, cls: ConflictClass, reason: string) => {
    reject(w, cls, reason);
    dropped.add(groupKey(w));
    // A required personal/tax fact with no valid replacement blocks canonical use.
    blocked = true;
  };

  for (const [, byKey] of cohorts) {
    const wages = byKey.get("WAGES_W2");
    const agi = byKey.get("ADJUSTED_GROSS_INCOME") ?? byKey.get("AGI");
    const totalIncome = byKey.get("TOTAL_INCOME");
    const taxable = byKey.get("TAXABLE_INCOME");
    const netIncome = byKey.get("NET_INCOME");

    // Gate: AGI cannot be zero when wages/income are material.
    if (agi && agi.fact_value_num === 0 && (isMaterial(wages?.fact_value_num ?? null) || isMaterial(totalIncome?.fact_value_num ?? null))) {
      gateRejectWinner(agi, "material_zero_fact", "AGI is 0 while material wages/income exist — impossible; excluded (canonical use blocked until resolved).");
    }

    // Gate: TOTAL_INCOME cannot be below WAGES_W2.
    if (totalIncome && wages && isMaterial(wages.fact_value_num) && totalIncome.fact_value_num !== null && totalIncome.fact_value_num < wages.fact_value_num && !dropped.has(groupKey(totalIncome))) {
      gateRejectWinner(totalIncome, "impossible_personal_income_relationship", `TOTAL_INCOME ${totalIncome.fact_value_num} is below WAGES_W2 ${wages.fact_value_num} — impossible; excluded.`);
    }

    // Gate: NET_INCOME = 0 cannot silently win when material TAXABLE_INCOME exists.
    if (netIncome && netIncome.fact_value_num === 0 && isMaterial(taxable?.fact_value_num ?? null) && !dropped.has(groupKey(netIncome))) {
      gateRejectWinner(netIncome, "material_zero_fact", `NET_INCOME is 0 while material TAXABLE_INCOME ${taxable!.fact_value_num} exists — excluded.`);
    }

    // Caveat (not reject): TAXABLE_INCOME tiny vs material AGI.
    if (taxable && agi && isMaterial(agi.fact_value_num) && taxable.fact_value_num !== null && Math.abs(taxable.fact_value_num) < Math.abs(agi.fact_value_num) * TINY_RATIO && !dropped.has(groupKey(taxable))) {
      caveats.push(`TAXABLE_INCOME ${taxable.fact_value_num} is unusually small relative to AGI ${agi.fact_value_num}; verify before committee.`);
    }
  }

  // ── Build outputs ─────────────────────────────────────────────────────────
  const selected: ReconcileFact[] = [];
  for (const [k, w] of winners) {
    if (!dropped.has(k)) selected.push(w);
  }

  const byClass = emptyByClass();
  for (const r of rejected) byClass[r.conflictClass] += 1;

  let confidenceTier: ConfidenceTier;
  if (blocked) confidenceTier = "blocked";
  else if (byClass.extractor_conflict > 0 || rejected.length > 2 || caveats.length > 1) confidenceTier = "low";
  else if (rejected.length > 0 || caveats.length > 0) confidenceTier = "medium";
  else confidenceTier = "high";

  return {
    selected,
    rejected,
    confidenceTier,
    caveats,
    blocked,
    summary: {
      groups: groups.size,
      selectedCount: selected.length,
      rejectedCount: rejected.length,
      byClass,
    },
  };
}
