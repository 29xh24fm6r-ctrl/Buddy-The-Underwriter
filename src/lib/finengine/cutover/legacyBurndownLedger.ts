/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 26: Legacy Burn-Down Ledger.
 *
 * Machine-readable ledger of every quarantined legacy producer: its consumers,
 * the finengine replacement, the cutover flag, reconciliation status, and
 * deletion eligibility. The safety invariant (rule 4): NOTHING is deletion-
 * eligible unless its reconciliation is clean AND its cutover flag is live — and
 * even then a human performs the deletion in the final burn-down. Today every
 * entry is deletion-INELIGIBLE.
 *
 * The human-readable mirror lives in docs/finengine/legacy-burndown-ledger.md.
 * Pure data + a validator; no writes.
 */

import type { ConsumerId, ProducerKey } from "@/lib/finengine/cutover/legacyProducerAdapters";

export type ReconciliationStatus = "not_started" | "in_progress" | "clean" | "blocked";

export type BurndownEntry = {
  producer: ProducerKey | string;
  /** Legacy source module path. */
  legacyModule: string;
  consumers: (ConsumerId | string)[];
  /** finengine replacement module (or "quarantine" for kill-switched paths). */
  replacementModule: string;
  cutoverFlag: string;
  reconciliationStatus: ReconciliationStatus;
  /** Only ever true when reconciliation clean + flag live + human-approved. */
  deletionEligible: boolean;
  notes: string;
};

export const LEGACY_BURNDOWN_LEDGER: BurndownEntry[] = [
  {
    producer: "computeGlobalCashFlow",
    legacyModule: "src/lib/financialSpreads/* (GCF compute path)",
    consumers: ["gcf_route", "snapshot_recompute", "financial_readiness"],
    replacementModule: "src/lib/finengine/methods/global.ts + shadow/globalCashFlowAdapter.ts",
    cutoverFlag: "ProducerFlags.computeGlobalCashFlow (default false)",
    reconciliationStatus: "in_progress",
    deletionEligible: false,
    notes: "GCF assembler has no single legacy counterpart; shadow-only until reconciliation clean.",
  },
  {
    producer: "persistGlobalCashFlow",
    legacyModule: "src/lib/financialSpreads/renderSpread.ts::persistGcfComputedFacts",
    consumers: ["gcf_route", "spreads_processor"],
    replacementModule: "src/lib/finengine/gcf/circularWriterGuard.ts (kill switch) + certification writer",
    cutoverFlag: "GCF_CIRCULAR_WRITER_DISABLED (default enabled) + FINENGINE_CERTIFICATION_WRITER_ENABLED (default off)",
    reconciliationStatus: "in_progress",
    deletionEligible: false,
    notes: "Circular rendered-spread→facts writer. Quarantine-able via PR19 kill switch; not deleted.",
  },
  {
    producer: "computeTotalDebtService",
    legacyModule: "src/lib/financialSpreads/* (ADS/debt-service path)",
    consumers: ["snapshot_recompute", "spreads_processor", "pricing_assumptions_route", "financial_readiness"],
    replacementModule: "src/lib/finengine/cutover/ciTermDscrCutover.ts (C&I DSCR candidate)",
    cutoverFlag: "ProductCutoverFlagMap.CI_TERM (default false)",
    reconciliationStatus: "in_progress",
    deletionEligible: false,
    notes: "First safe cutover candidate (PR25). Legacy default until DSCR reconciliation is clean.",
  },
  {
    producer: "runCanonicalUnderwritingSynthesis",
    legacyModule: "src/lib/* (underwriting synthesis route path)",
    consumers: ["underwriting_synthesis_route"],
    replacementModule: "src/lib/finengine/memo/memoIntelligenceContract.ts + officer/examiner engines",
    cutoverFlag: "ProducerFlags.runCanonicalUnderwritingSynthesis (default false)",
    reconciliationStatus: "not_started",
    deletionEligible: false,
    notes: "Memo/synthesis consumes certified analytical objects; shadow adapter (PR23) compares first.",
  },
];

export type LedgerValidation = { ok: boolean; violations: string[] };

/**
 * Enforce safety rule 4: an entry may be deletion-eligible ONLY if its
 * reconciliation is clean. Any deletion-eligible entry that is not clean is a
 * violation. (Cutover flags being live is a further human gate, not encoded here.)
 */
export function validateBurndownLedger(ledger: BurndownEntry[] = LEGACY_BURNDOWN_LEDGER): LedgerValidation {
  const violations: string[] = [];
  for (const e of ledger) {
    if (e.deletionEligible && e.reconciliationStatus !== "clean") {
      violations.push(`${e.producer}: deletionEligible but reconciliation is ${e.reconciliationStatus}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

/** No producer may be deleted yet (current arc state). */
export function anyDeletionEligible(ledger: BurndownEntry[] = LEGACY_BURNDOWN_LEDGER): boolean {
  return ledger.some((e) => e.deletionEligible);
}
