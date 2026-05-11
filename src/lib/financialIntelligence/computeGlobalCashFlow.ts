/**
 * Global Cash Flow — Pure Computation
 *
 * Aggregates entity-level income (tax returns / IS / NOI) and sponsor personal
 * income flows into a single global cash flow available for debt service, then
 * computes Global DSCR.
 *
 * Pure function — no DB, no server-only, fully deterministic.
 *
 * SPEC-B4: Optional methodologySlate parameter controls ownership fallback
 * (axis 4: affiliate_ownership) and personal obligations treatment
 * (axis 5: living_expense). When omitted, uses pre-B4 behavior
 * (ownershipPct ?? 1, stated obligations as-is).
 */

import type { MethodologySlate } from "@/lib/methodology/types";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type GcfEntityInput = {
  entityId: string;
  entityName: string;
  entityType: "OPERATING" | "PASSTHROUGH" | "PERSONAL";
  /** 0-1 range. null = assume 100% ownership */
  ownershipPct: number | null;
  /** Entity-level net income (NOI for RE, ordinary income for opco) */
  netIncome: number | null;
  /** Depreciation to add back */
  depreciation: number | null;
  /** Interest expense to add back (for EBITDA-based analysis) */
  interestExpense: number | null;
  /** Entity-level annual debt service */
  debtService: number | null;
};

export type GcfSponsorInput = {
  ownerId: string;
  ownerName: string;
  /** Total personal income (W-2 wages, Schedule E, K-1 flow-through, etc.) */
  totalPersonalIncome: number | null;
  /** Annual personal obligations (housing, auto, revolving debt, etc.) */
  personalObligations: number | null;
};

export type GcfInputs = {
  entities: GcfEntityInput[];
  sponsors: GcfSponsorInput[];
  /** Annual proposed debt service for the deal */
  proposedDebtService: number | null;
  /** Annual existing debt service already captured at deal level */
  existingDebtService: number | null;
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type GcfEntityResult = {
  entityId: string;
  entityName: string;
  entityType: string;
  ownershipPct: number | null;
  grossCashFlow: number | null;
  allocatedCashFlow: number | null;
  debtService: number | null;
  netContribution: number | null;
};

export type GcfSponsorResult = {
  ownerId: string;
  ownerName: string;
  totalPersonalIncome: number | null;
  personalObligations: number | null;
  netPersonalCashFlow: number | null;
};

export type GcfResult = {
  entities: GcfEntityResult[];
  sponsors: GcfSponsorResult[];
  totalEntityCashFlow: number | null;
  totalPersonalCashFlow: number | null;
  globalCashFlowAvailable: number | null;
  totalDebtService: number | null;
  globalDscr: number | null;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

// SPEC-B4: IRS National Standards minimum living expense floors (2025)
// Applied when living_expense variant is "sba_sop_minimum"
const SBA_LIVING_EXPENSE_FLOOR_SINGLE = 24_000;  // annual
const SBA_LIVING_EXPENSE_FLOOR_FAMILY = 48_000;  // annual, family of 4

export function computeGlobalCashFlow(
  inputs: GcfInputs,
  methodologySlate?: MethodologySlate,
): GcfResult {
  const warnings: string[] = [];

  // SPEC-B4: resolve methodology variants
  const ownershipVariant = methodologySlate?.affiliate_ownership ?? "standard";
  const livingExpenseVariant = methodologySlate?.living_expense ?? "standard";

  // --- Entity contributions ---
  const entityResults: GcfEntityResult[] = [];
  let totalEntityCashFlow: number | null = null;

  for (const e of inputs.entities) {
    // SPEC-B4 axis 4: ownership fallback behavior
    let effectiveOwnershipPct: number | null = e.ownershipPct;

    if (ownershipVariant === "conservative") {
      // Conservative: unknown → 0 (exclude), below 50% → exclude
      if (e.ownershipPct === null) {
        effectiveOwnershipPct = 0;
        warnings.push(
          `Ownership unknown for "${e.entityName}" — excluded (conservative methodology)`,
        );
      } else if (e.ownershipPct < 0.50) {
        effectiveOwnershipPct = 0;
        warnings.push(
          `Ownership ${(e.ownershipPct * 100).toFixed(0)}% for "${e.entityName}" — excluded below 50% floor (conservative methodology)`,
        );
      }
    } else if (ownershipVariant === "documented_only") {
      // Documented-only: unknown → 0 (exclude)
      if (e.ownershipPct === null) {
        effectiveOwnershipPct = 0;
        warnings.push(
          `Ownership undocumented for "${e.entityName}" — excluded (documented-only methodology)`,
        );
      }
    } else {
      // Standard: unknown → assume 100%
      if (e.ownershipPct === null) {
        warnings.push(
          `Ownership percentage unknown for "${e.entityName}" — assuming 100%`,
        );
      }
    }

    // Gross cash flow = net income + depreciation + interest (EBITDA proxy)
    let grossCashFlow: number | null = null;
    if (e.netIncome !== null) {
      grossCashFlow = e.netIncome + (e.depreciation ?? 0) + (e.interestExpense ?? 0);
    }

    // Allocated = gross × ownership %
    let allocatedCashFlow: number | null = null;
    if (grossCashFlow !== null) {
      const pct = ownershipVariant === "standard"
        ? (effectiveOwnershipPct ?? 1)
        : (effectiveOwnershipPct ?? 0);
      allocatedCashFlow = grossCashFlow * pct;
    }

    // Net contribution = allocated - entity debt service
    let netContribution: number | null = null;
    if (allocatedCashFlow !== null) {
      netContribution = allocatedCashFlow - (e.debtService ?? 0);
    }

    if (allocatedCashFlow !== null) {
      totalEntityCashFlow = (totalEntityCashFlow ?? 0) + allocatedCashFlow;
    }

    entityResults.push({
      entityId: e.entityId,
      entityName: e.entityName,
      entityType: e.entityType,
      ownershipPct: e.ownershipPct,
      grossCashFlow,
      allocatedCashFlow,
      debtService: e.debtService,
      netContribution,
    });
  }

  // --- Sponsor personal contributions ---
  const sponsorResults: GcfSponsorResult[] = [];
  let totalPersonalCashFlow: number | null = null;

  for (const s of inputs.sponsors) {
    let netPersonalCashFlow: number | null = null;
    if (s.totalPersonalIncome !== null) {
      // SPEC-B4 axis 5: living expense treatment
      let effectiveObligations = s.personalObligations ?? 0;

      if (livingExpenseVariant === "sba_sop_minimum") {
        // Apply IRS National Standards floor
        const sopFloor = SBA_LIVING_EXPENSE_FLOOR_SINGLE; // TODO: use household size when available
        effectiveObligations = Math.max(effectiveObligations, sopFloor);
      } else if (livingExpenseVariant === "buffered") {
        // Stated × 1.10x
        effectiveObligations = effectiveObligations * 1.10;
      }
      // "standard" — use stated as-is (no transformation)

      netPersonalCashFlow = s.totalPersonalIncome - effectiveObligations;
    } else {
      warnings.push(
        `Personal income unknown for "${s.ownerName}" — excluded from global cash flow`,
      );
    }

    if (netPersonalCashFlow !== null) {
      totalPersonalCashFlow = (totalPersonalCashFlow ?? 0) + netPersonalCashFlow;
    }

    sponsorResults.push({
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      totalPersonalIncome: s.totalPersonalIncome,
      personalObligations: s.personalObligations,
      netPersonalCashFlow,
    });
  }

  // --- Global aggregation ---
  let globalCashFlowAvailable: number | null = null;
  if (totalEntityCashFlow !== null || totalPersonalCashFlow !== null) {
    globalCashFlowAvailable = (totalEntityCashFlow ?? 0) + (totalPersonalCashFlow ?? 0);
  }

  // Total debt service = proposed + existing
  let totalDebtService: number | null = null;
  if (inputs.proposedDebtService !== null || inputs.existingDebtService !== null) {
    totalDebtService = (inputs.proposedDebtService ?? 0) + (inputs.existingDebtService ?? 0);
  }

  // Global DSCR = cash flow available / total debt service
  let globalDscr: number | null = null;
  if (
    globalCashFlowAvailable !== null &&
    totalDebtService !== null &&
    totalDebtService > 0
  ) {
    globalDscr = Math.round((globalCashFlowAvailable / totalDebtService) * 100) / 100;
  }

  if (globalCashFlowAvailable !== null && globalCashFlowAvailable < 0) {
    warnings.push(
      "Global cash flow is negative — borrower may lack capacity for additional debt service",
    );
  }

  if (globalDscr !== null && globalDscr < 1.0) {
    warnings.push(
      `Global DSCR ${globalDscr.toFixed(2)}x is below 1.0x — insufficient cash flow to cover debt service`,
    );
  }

  return {
    entities: entityResults,
    sponsors: sponsorResults,
    totalEntityCashFlow,
    totalPersonalCashFlow,
    globalCashFlowAvailable,
    totalDebtService,
    globalDscr,
    warnings,
  };
}
