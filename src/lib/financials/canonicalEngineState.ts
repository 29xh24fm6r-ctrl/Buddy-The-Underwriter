/**
 * SPEC-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-AND-ADS-MATERIALIZATION-1
 *
 * Pure core that re-projects a deal's active financial facts through the SAME
 * canonical/certified selectors the Global Cash Flow page and the classic
 * spreads use, so Financial Analysis can never present a value that disagrees
 * with GCF/spreads:
 *
 *   - GCF_GLOBAL_CASH_FLOW / GCF_DSCR  → canonicalGcfCore (resolveGcfFactValue)
 *   - CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE → certifyFactSelection (DEAL)
 *   - certified personal income        → buildCertifiedGcfPersonalIncome
 *   - PFS_ANNUAL_DEBT_SERVICE / PFS_LIVING_EXPENSES → latest active PERSONAL fact
 *   - GCF prerequisites + diagnostics  → evaluateGcfPrerequisites
 *
 * NO "server-only" so it is unit-testable. The snapshot builder loads the facts
 * and calls these; it must NOT independently reselect weaker raw facts for the
 * keys covered here.
 */

import {
  resolveGcfFactValue,
  evaluateGcfPrerequisites,
  GCF_DSCR_FACT_KEY,
  type GcfFactRow,
} from "@/lib/financialFacts/canonicalGcfCore";
import {
  certifyFactSelection,
  getCertified,
  type CertifiableFact,
} from "@/lib/classicSpread/certification/certifyFactSelection";
import { buildCertifiedGcfPersonalIncome } from "@/lib/classicSpread/personalIncomeSelection";
import type { PersonalIncomeFact } from "@/lib/classicSpread/certification/certifiedPersonalIncome";

/** Broad row shape covering everything the canonical selectors read. */
export type EngineFactRow = {
  id?: string | null;
  fact_key: string;
  fact_type?: string | null;
  fact_value_num: number | null;
  owner_type?: string | null;
  owner_entity_id?: string | null;
  fact_period_start?: string | null;
  fact_period_end?: string | null;
  source_document_id?: string | null;
  source_canonical_type?: string | null;
  confidence?: number | null;
  provenance?: any;
  created_at?: string | null;
  is_superseded?: boolean | null;
  resolution_status?: string | null;
};

export type CanonicalEngineValueSource =
  | "certified_fact"
  | "canonical_fact"
  | "legacy_fact"
  | "active_fact"
  | null;

export type CanonicalEngineValue = {
  value: number | null;
  source: CanonicalEngineValueSource;
  factKey: string | null;
  asOf: string | null;
};

export type CanonicalFinancialEngineState = {
  cashFlowAvailable: CanonicalEngineValue;
  annualDebtService: CanonicalEngineValue;
  personalTotalIncome: CanonicalEngineValue;
  gcfGlobalCashFlow: CanonicalEngineValue;
  gcfDscr: CanonicalEngineValue;
  pfsAnnualDebtService: CanonicalEngineValue;
  pfsLivingExpenses: CanonicalEngineValue;
  /** GCF dependency-ordered prerequisites resolution (same engine as the GCF page). */
  prerequisitesReady: boolean;
  earliestMissingPrerequisite: { key: string; label: string; diagnostic: string } | null;
  diagnostics: string[];
};

const EMPTY_VALUE: CanonicalEngineValue = { value: null, source: null, factKey: null, asOf: null };

function isActiveNumeric(r: EngineFactRow): boolean {
  return (
    r.is_superseded !== true &&
    (r.resolution_status ?? "").toLowerCase() !== "rejected" &&
    typeof r.fact_value_num === "number" &&
    Number.isFinite(r.fact_value_num)
  );
}

function recency(r: EngineFactRow): string {
  return r.fact_period_end ?? r.created_at ?? "";
}

/** Latest active numeric fact for a key (optionally pinned to an owner type). */
function latestActive(
  rows: EngineFactRow[],
  factKey: string,
  ownerType?: string,
): EngineFactRow | null {
  const matches = rows.filter(
    (r) =>
      r.fact_key === factKey &&
      isActiveNumeric(r) &&
      (ownerType == null || (r.owner_type ?? "DEAL") === ownerType),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => recency(b).localeCompare(recency(a)));
  return matches[0];
}

function toCertifiable(r: EngineFactRow): CertifiableFact {
  return {
    id: r.id ?? null,
    fact_key: r.fact_key,
    fact_period_end: r.fact_period_end ?? null,
    owner_type: r.owner_type ?? "DEAL",
    owner_entity_id: r.owner_entity_id ?? null,
    source_document_id: r.source_document_id ?? null,
    source_canonical_type: r.source_canonical_type ?? null,
    confidence: r.confidence ?? null,
    extractor: (r.provenance?.extractor as string | undefined) ?? null,
    fact_value_num: r.fact_value_num,
    is_superseded: r.is_superseded ?? false,
    resolution_status: r.resolution_status ?? null,
  };
}

function toPersonalIncomeFact(r: EngineFactRow): PersonalIncomeFact {
  return {
    id: r.id ?? null,
    fact_key: r.fact_key,
    fact_value_num: r.fact_value_num,
    fact_period_end: r.fact_period_end ?? null,
    owner_type: r.owner_type ?? "DEAL",
    owner_entity_id: r.owner_entity_id ?? null,
    source_document_id: r.source_document_id ?? null,
    source_canonical_type: r.source_canonical_type ?? null,
    fact_type: r.fact_type ?? null,
    confidence: r.confidence ?? null,
    extractor: (r.provenance?.extractor as string | undefined) ?? null,
    is_superseded: r.is_superseded ?? false,
    resolution_status: r.resolution_status ?? null,
  };
}

/** Certify a DEAL-owned single-value key (CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE). */
function certifyDealKey(rows: EngineFactRow[], factKey: string): CanonicalEngineValue {
  const candidates = rows.filter((r) => r.fact_key === factKey);
  if (candidates.length === 0) return EMPTY_VALUE;
  const selection = certifyFactSelection(candidates.map(toCertifiable));
  // Pick the most-recent certified period (single-owner deal keys).
  let best: { value: number; asOf: string | null } | null = null;
  for (const r of candidates) {
    const period = r.fact_period_end ?? "";
    const cv = getCertified(selection, factKey, period, "DEAL", r.owner_entity_id ?? null);
    if (cv && cv.status === "certified" && cv.value !== null) {
      if (!best || period.localeCompare(best.asOf ?? "") > 0) {
        best = { value: cv.value, asOf: r.fact_period_end ?? null };
      }
    }
  }
  if (!best) {
    // Certification dropped everything (superseded / micro-stub / conflict): fall
    // back to the latest active fact so a real value is not silently hidden.
    const active = latestActive(rows, factKey, "DEAL");
    if (active?.fact_value_num != null) {
      return { value: Number(active.fact_value_num), source: "active_fact", factKey, asOf: active.fact_period_end ?? null };
    }
    return EMPTY_VALUE;
  }
  return { value: best.value, source: "certified_fact", factKey, asOf: best.asOf };
}

/**
 * Build the canonical/certified financial engine state for a deal from its
 * already-loaded ACTIVE facts (caller filters is_superseded / rejected).
 */
export function buildCanonicalEngineState(rows: EngineFactRow[]): CanonicalFinancialEngineState {
  const diagnostics: string[] = [];

  // ── GCF value + DSCR via the exact canonical resolver the GCF page uses ──
  const gcfRows: GcfFactRow[] = rows.map((r) => ({
    fact_key: r.fact_key,
    fact_value_num: r.fact_value_num,
    fact_type: r.fact_type ?? null,
    owner_type: r.owner_type ?? null,
    owner_entity_id: r.owner_entity_id ?? null,
    fact_period_end: r.fact_period_end ?? null,
    created_at: r.created_at ?? null,
    is_superseded: r.is_superseded ?? null,
  }));
  const gcfFact = resolveGcfFactValue(gcfRows);
  const gcfDscrRow = latestActive(rows, GCF_DSCR_FACT_KEY);
  const prereq = evaluateGcfPrerequisites(gcfRows);

  if (gcfFact.usedLegacy) {
    diagnostics.push(
      "Using legacy GLOBAL_CASH_FLOW fact — canonical GCF_GLOBAL_CASH_FLOW not materialized; recompute to refresh.",
    );
  }
  if (!prereq.ready && prereq.earliestMissing) {
    diagnostics.push(prereq.earliestMissing.diagnostic);
  }

  const pfsAds = latestActive(rows, "PFS_ANNUAL_DEBT_SERVICE", "PERSONAL");
  const pfsLiving = latestActive(rows, "PFS_LIVING_EXPENSES", "PERSONAL");

  const personal = buildCertifiedGcfPersonalIncome(rows.map(toPersonalIncomeFact));

  return {
    cashFlowAvailable: certifyDealKey(rows, "CASH_FLOW_AVAILABLE"),
    annualDebtService: certifyDealKey(rows, "ANNUAL_DEBT_SERVICE"),
    personalTotalIncome: {
      value: personal.value,
      source: personal.value !== null ? "certified_fact" : null,
      factKey: personal.value !== null ? "GCF_PERSONAL_INCOME" : null,
      asOf: personal.asOf,
    },
    gcfGlobalCashFlow: {
      value: gcfFact.value,
      source: gcfFact.factKey ? (gcfFact.usedLegacy ? "legacy_fact" : "canonical_fact") : null,
      factKey: gcfFact.factKey,
      asOf: gcfFact.asOf,
    },
    gcfDscr: {
      value: gcfDscrRow?.fact_value_num != null ? Number(gcfDscrRow.fact_value_num) : null,
      source: gcfDscrRow ? "canonical_fact" : null,
      factKey: gcfDscrRow ? GCF_DSCR_FACT_KEY : null,
      asOf: gcfDscrRow?.fact_period_end ?? null,
    },
    pfsAnnualDebtService: {
      value: pfsAds?.fact_value_num != null ? Number(pfsAds.fact_value_num) : null,
      source: pfsAds ? "active_fact" : null,
      factKey: pfsAds ? "PFS_ANNUAL_DEBT_SERVICE" : null,
      asOf: pfsAds?.fact_period_end ?? null,
    },
    pfsLivingExpenses: {
      value: pfsLiving?.fact_value_num != null ? Number(pfsLiving.fact_value_num) : null,
      source: pfsLiving ? "active_fact" : null,
      factKey: pfsLiving ? "PFS_LIVING_EXPENSES" : null,
      asOf: pfsLiving?.fact_period_end ?? null,
    },
    prerequisitesReady: prereq.ready,
    earliestMissingPrerequisite: prereq.earliestMissing
      ? {
          key: prereq.earliestMissing.key,
          label: prereq.earliestMissing.label,
          diagnostic: prereq.earliestMissing.diagnostic,
        }
      : null,
    diagnostics,
  };
}
