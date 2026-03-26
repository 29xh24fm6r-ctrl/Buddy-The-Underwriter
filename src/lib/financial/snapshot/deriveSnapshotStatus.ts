/**
 * Phase 55A — Snapshot Status Derivation
 *
 * Pure function. Single source of truth for "what status should this snapshot have?"
 */

import type { FinancialSnapshotStatus } from "./types";
import type { FactValidationState } from "./financial-fact-types";

type StatusInput = {
  factCount: number;
  validatedFactCount: number;
  unresolvedConflictCount: number;
  missingCriticalFactCount: number;
  hasStaleSources: boolean;
  isSuperseded: boolean;
  hasAnyExtractedInput: boolean;
};

/**
 * Derive canonical snapshot status from aggregate fact state.
 */
export function deriveSnapshotStatus(input: StatusInput): FinancialSnapshotStatus {
  if (input.isSuperseded) return "superseded";
  if (input.hasStaleSources) return "stale";
  if (!input.hasAnyExtractedInput) return "not_started";
  if (input.factCount === 0) return "collecting_inputs";

  if (input.unresolvedConflictCount > 0 || input.missingCriticalFactCount > 0) {
    return "needs_review";
  }

  if (input.validatedFactCount > 0 && input.validatedFactCount < input.factCount) {
    return "partially_validated";
  }

  if (input.validatedFactCount >= input.factCount && input.factCount > 0) {
    return "validated";
  }

  return "generated";
}

/**
 * Map per-fact validation states into aggregate counts.
 */
export function aggregateFactStates(states: FactValidationState[]): {
  total: number;
  validated: number;
  unresolved: number;
  missing: number;
} {
  const validated = new Set<FactValidationState>(["banker_confirmed", "banker_adjusted", "auto_supported"]);
  const unresolved = new Set<FactValidationState>(["conflicted", "needs_review"]);

  return {
    total: states.length,
    validated: states.filter((s) => validated.has(s)).length,
    unresolved: states.filter((s) => unresolved.has(s)).length,
    missing: states.filter((s) => s === "missing").length,
  };
}
