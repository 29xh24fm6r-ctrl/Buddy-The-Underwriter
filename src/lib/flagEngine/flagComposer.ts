/**
 * Flag Composer — orchestrates all 5 flag modules, deduplicates, and sorts.
 *
 * Pure function — no DB, no server imports.
 */

import type { FlagEngineInput, FlagEngineOutput, SpreadFlag, FlagSeverity, FlagCategory } from "./types";
import { flagFromRatios } from "./flagFromRatios";
import { flagFromReconciliation } from "./flagFromReconciliation";
import { flagFromQoE } from "./flagFromQoE";
import { flagFromTrends } from "./flagFromTrends";
import { flagFromDocuments } from "./flagFromDocuments";
import { resetFlagCounter } from "./flagHelpers";

// ---------------------------------------------------------------------------
// Severity and category sort ordinals
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<FlagSeverity, number> = {
  critical: 0,
  elevated: 1,
  watch: 2,
  informational: 3,
};

const CATEGORY_ORDER: Record<FlagCategory, number> = {
  financial_irregularity: 0,
  missing_data: 1,
  policy_proximity: 2,
  qualitative_risk: 3,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function composeFlagReport(input: FlagEngineInput): FlagEngineOutput {
  // Reset counter for deterministic IDs within a single run
  resetFlagCounter();

  // 1. Collect flags from all 5 modules
  const allFlags: SpreadFlag[] = [
    ...flagFromRatios(input),
    ...flagFromReconciliation(input),
    ...flagFromQoE(input),
    ...flagFromTrends(input),
    ...flagFromDocuments(input),
  ];

  // 2. Deduplicate: same trigger_type + same canonical_keys → keep higher severity
  const deduped = deduplicateFlags(allFlags);

  // 3. Sort: severity (critical first), then category
  const sorted = deduped.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  });

  // 4. Count by severity
  let critical = 0;
  let elevated = 0;
  let watch = 0;
  let informational = 0;
  for (const f of sorted) {
    switch (f.severity) {
      case "critical": critical++; break;
      case "elevated": elevated++; break;
      case "watch": watch++; break;
      case "informational": informational++; break;
    }
  }

  return {
    deal_id: input.deal_id,
    flags: sorted,
    critical_count: critical,
    elevated_count: elevated,
    watch_count: watch,
    informational_count: informational,
    has_blocking_flags: critical > 0,
  };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateFlags(flags: SpreadFlag[]): SpreadFlag[] {
  const map = new Map<string, SpreadFlag>();

  for (const flag of flags) {
    const key = dedupKey(flag);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, flag);
    } else {
      // Keep the one with higher severity (lower ordinal)
      if (SEVERITY_ORDER[flag.severity] < SEVERITY_ORDER[existing.severity]) {
        map.set(key, flag);
      }
    }
  }

  return Array.from(map.values());
}

function dedupKey(flag: SpreadFlag): string {
  const keys = [...flag.canonical_keys_involved].sort().join(",");
  return `${flag.trigger_type}|${keys}`;
}
