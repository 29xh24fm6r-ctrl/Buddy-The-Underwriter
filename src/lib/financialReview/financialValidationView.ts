/**
 * SPEC-COCKPIT-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-VIEW-1
 *
 * Pure view-model for the cockpit Financial Analysis (Financial Validation)
 * card. It reconciles the legacy gap-queue surface with the canonical/certified
 * financial engine state (canonical_engine, surfaced on the financial-snapshot
 * GET route) so the card shows the SAME numbers and prerequisite diagnostics as
 * the GCF page, spreads, and financial snapshots.
 *
 * NO React, NO "server-only" — unit-testable in isolation.
 *
 * Rules:
 *   - When the engine reports prerequisites READY, stale "missing required fact"
 *     gaps for engine-managed keys (ADS/DSCR/CFA/GCF/PFS) are dropped (req 10) —
 *     but conflicts, low-confidence, and non-engine missing facts are NEVER
 *     hidden (req 7).
 *   - When the engine reports prerequisites MISSING, the same dependency-ordered
 *     diagnostics the GCF page uses are surfaced (req 11).
 *   - A persisted snapshot row without a decision row is an explicit, recoverable
 *     state — never "no review needed yet" (req 13).
 *   - No snapshot at all keeps the existing generate-snapshot affordance (req 12).
 */

import type { CanonicalFinancialEngineState } from "@/lib/financials/canonicalEngineState";
import { CANONICAL_ENGINE_MANAGED_FACT_KEYS } from "@/lib/financials/canonicalEngineState";

export type ValidationGap = {
  id: string;
  gap_type: "missing_fact" | "low_confidence" | "conflict";
  fact_key: string;
  description: string;
  resolution_prompt: string;
  priority: number;
  fact_id: string | null;
  conflict_id: string | null;
};

export type FinancialPackageStatus = {
  snapshotRowExists: boolean;
  decisionRowExists: boolean;
};

export type EngineDisplayValue = {
  label: string;
  factKey: string;
  value: number | null;
  /** percent-like ratio (DSCR) vs currency — for formatting */
  kind: "currency" | "ratio";
};

export type FinancialValidationStatus =
  | "loading"
  | "no_snapshot"
  | "recoverable_decision_missing"
  | "prerequisites_missing"
  | "needs_review"
  | "ready_no_review";

export type FinancialValidationViewModel = {
  status: FinancialValidationStatus;
  /** The 7 canonical engine values to display (always present; value may be null). */
  engineValues: EngineDisplayValue[];
  /** Review items to render (engine-prerequisite stale gaps removed when ready). */
  reviewItems: ValidationGap[];
  /** Dependency-ordered prerequisite diagnostics (GCF order) when not ready; else null. */
  prerequisites: {
    ready: boolean;
    ordered: { key: string; label: string; satisfied: boolean; diagnostic: string }[];
    earliestMissing: { key: string; label: string; diagnostic: string } | null;
    diagnostics: string[];
  } | null;
  completeness: number;
};

const GAP_TYPE_ORDER: Record<string, number> = { conflict: 0, missing_fact: 1, low_confidence: 2 };

export function sortReviewItems(gaps: ValidationGap[]): ValidationGap[] {
  return [...gaps].sort((a, b) => {
    const typeA = GAP_TYPE_ORDER[a.gap_type] ?? 9;
    const typeB = GAP_TYPE_ORDER[b.gap_type] ?? 9;
    if (typeA !== typeB) return typeA - typeB;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.fact_key.localeCompare(b.fact_key);
  });
}

/**
 * Drop ONLY stale engine-prerequisite *missing_fact* gaps when the engine reports
 * prerequisites ready. Conflicts, low-confidence, and any non-engine missing fact
 * always survive — those are real banker-review items.
 */
export function filterStaleEnginePrerequisiteGaps(
  gaps: ValidationGap[],
  engine: CanonicalFinancialEngineState | null,
): ValidationGap[] {
  if (!engine?.prerequisitesReady) return gaps;
  return gaps.filter((g) => {
    if (g.gap_type !== "missing_fact") return true; // never hide conflicts / low-confidence
    return !CANONICAL_ENGINE_MANAGED_FACT_KEYS.has(g.fact_key);
  });
}

function engineValues(engine: CanonicalFinancialEngineState | null): EngineDisplayValue[] {
  const e = engine;
  return [
    { label: "Cash flow available", factKey: "CASH_FLOW_AVAILABLE", value: e?.cashFlowAvailable.value ?? null, kind: "currency" },
    { label: "Annual debt service", factKey: "ANNUAL_DEBT_SERVICE", value: e?.annualDebtService.value ?? null, kind: "currency" },
    { label: "Personal debt service (PFS)", factKey: "PFS_ANNUAL_DEBT_SERVICE", value: e?.pfsAnnualDebtService.value ?? null, kind: "currency" },
    { label: "Personal living expenses (PFS)", factKey: "PFS_LIVING_EXPENSES", value: e?.pfsLivingExpenses.value ?? null, kind: "currency" },
    { label: "Certified personal income", factKey: "PERSONAL_TOTAL_INCOME", value: e?.personalTotalIncome.value ?? null, kind: "currency" },
    { label: "Global cash flow", factKey: "GCF_GLOBAL_CASH_FLOW", value: e?.gcfGlobalCashFlow.value ?? null, kind: "currency" },
    { label: "Global DSCR", factKey: "GCF_DSCR", value: e?.gcfDscr.value ?? null, kind: "ratio" },
  ];
}

export function buildFinancialValidationViewModel(input: {
  loading?: boolean;
  /** legacy deal_truth_snapshots existence (gap-queue) */
  financialSnapshotExists: boolean;
  /** persisted financial_snapshots / financial_snapshot_decisions presence */
  financialPackage: FinancialPackageStatus | null;
  canonicalEngine: CanonicalFinancialEngineState | null;
  gaps: ValidationGap[];
  completeness: number;
}): FinancialValidationViewModel {
  const values = engineValues(input.canonicalEngine);

  if (input.loading) {
    return { status: "loading", engineValues: values, reviewItems: [], prerequisites: null, completeness: input.completeness };
  }

  const snapshotRowExists = input.financialPackage?.snapshotRowExists ?? false;
  const decisionRowExists = input.financialPackage?.decisionRowExists ?? false;
  const snapshotPresent = input.financialSnapshotExists || snapshotRowExists;

  // ── No reviewable snapshot at all → keep the generate-snapshot affordance ──
  if (!snapshotPresent) {
    return { status: "no_snapshot", engineValues: values, reviewItems: [], prerequisites: null, completeness: input.completeness };
  }

  // ── Persisted snapshot row but no decision row → explicit recoverable state ──
  if (snapshotRowExists && !decisionRowExists) {
    return {
      status: "recoverable_decision_missing",
      engineValues: values,
      reviewItems: [],
      prerequisites: null,
      completeness: input.completeness,
    };
  }

  const reviewItems = sortReviewItems(filterStaleEnginePrerequisiteGaps(input.gaps, input.canonicalEngine));

  const engine = input.canonicalEngine;
  const prerequisites = engine
    ? {
        ready: engine.prerequisitesReady,
        ordered: engine.prerequisites.map((p) => ({
          key: p.key,
          label: p.label,
          satisfied: p.satisfied,
          diagnostic: p.diagnostic,
        })),
        earliestMissing: engine.earliestMissingPrerequisite,
        diagnostics: engine.diagnostics,
      }
    : null;

  // ── Engine prerequisites missing → surface the GCF-ordered diagnostics ──
  if (engine && !engine.prerequisitesReady) {
    return {
      status: "prerequisites_missing",
      engineValues: values,
      reviewItems, // real, non-engine review items still surface alongside
      prerequisites,
      completeness: input.completeness,
    };
  }

  if (reviewItems.length === 0) {
    return { status: "ready_no_review", engineValues: values, reviewItems, prerequisites, completeness: input.completeness };
  }

  return { status: "needs_review", engineValues: values, reviewItems, prerequisites, completeness: input.completeness };
}
