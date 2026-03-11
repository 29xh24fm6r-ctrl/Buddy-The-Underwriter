/**
 * Global Cash Flow — Pure Computation
 *
 * Aggregates entity-level income (tax returns / IS / NOI) and sponsor personal
 * income flows into a single global cash flow available for debt service, then
 * computes Global DSCR.
 *
 * Pure function — no DB, no server-only, fully deterministic.
 */

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

export function computeGlobalCashFlow(inputs: GcfInputs): GcfResult {
  const warnings: string[] = [];

  // --- Entity contributions ---
  const entityResults: GcfEntityResult[] = [];
  let totalEntityCashFlow: number | null = null;

  for (const e of inputs.entities) {
    if (e.ownershipPct === null) {
      warnings.push(
        `Ownership percentage unknown for "${e.entityName}" — assuming 100%`,
      );
    }

    // Gross cash flow = net income + depreciation + interest (EBITDA proxy)
    let grossCashFlow: number | null = null;
    if (e.netIncome !== null) {
      grossCashFlow = e.netIncome + (e.depreciation ?? 0) + (e.interestExpense ?? 0);
    }

    // Allocated = gross × ownership %
    let allocatedCashFlow: number | null = null;
    if (grossCashFlow !== null) {
      const pct = e.ownershipPct ?? 1;
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
      netPersonalCashFlow = s.totalPersonalIncome - (s.personalObligations ?? 0);
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
