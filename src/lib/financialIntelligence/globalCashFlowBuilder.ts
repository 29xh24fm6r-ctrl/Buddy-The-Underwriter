/**
 * Financial Intelligence Layer — Global Cash Flow Builder
 *
 * Aggregates income and debt obligations across multiple entities
 * to compute global net cash flow for the borrower.
 * Pure function — no DB, no server-only.
 */

export type EntityContribution = {
  entityName: string;
  entityType: "OPERATING_ENTITY" | "PASSTHROUGH" | "PERSONAL";
  grossIncome: number | null;
  ownershipPct: number | null;
  allocatedIncome: number | null;
  debtObligations: number | null;
  netContribution: number | null;
  formType: string;
  taxYear: number;
};

export type GlobalCashFlowSummary = {
  entities: EntityContribution[];
  totalAllocatedIncome: number | null;
  totalDebtObligations: number | null;
  globalNetCashFlow: number | null;
  warnings: string[];
};

export function buildGlobalCashFlow(
  entities: EntityContribution[],
): GlobalCashFlowSummary {
  const warnings: string[] = [];
  const resolved: EntityContribution[] = [];

  for (const entity of entities) {
    // Warn on missing ownership
    if (entity.ownershipPct === null) {
      warnings.push(
        `Ownership percentage unknown for ${entity.entityName} — allocated income may be overstated`,
      );
    }

    // Compute allocatedIncome
    let allocatedIncome: number | null = null;
    if (entity.grossIncome !== null) {
      allocatedIncome =
        entity.ownershipPct !== null
          ? entity.grossIncome * entity.ownershipPct
          : entity.grossIncome;
    }

    // Compute netContribution
    let netContribution: number | null = null;
    if (allocatedIncome !== null && entity.debtObligations !== null) {
      netContribution = allocatedIncome - entity.debtObligations;
    } else if (allocatedIncome === null || entity.debtObligations === null) {
      warnings.push(
        `Incomplete data for ${entity.entityName} — net contribution set to null`,
      );
    }

    resolved.push({
      ...entity,
      allocatedIncome,
      netContribution,
    });
  }

  // Aggregate totals — null-safe
  let totalAllocatedIncome: number | null = null;
  let totalDebtObligations: number | null = null;

  for (const e of resolved) {
    if (e.allocatedIncome !== null) {
      totalAllocatedIncome = (totalAllocatedIncome ?? 0) + e.allocatedIncome;
    }
    if (e.debtObligations !== null) {
      totalDebtObligations = (totalDebtObligations ?? 0) + e.debtObligations;
    }
  }

  let globalNetCashFlow: number | null = null;
  if (totalAllocatedIncome !== null && totalDebtObligations !== null) {
    globalNetCashFlow = totalAllocatedIncome - totalDebtObligations;
  }

  if (globalNetCashFlow !== null && globalNetCashFlow < 0) {
    warnings.push(
      "Global cash flow is negative — borrower may lack capacity for additional debt service",
    );
  }

  return {
    entities: resolved,
    totalAllocatedIncome,
    totalDebtObligations,
    globalNetCashFlow,
    warnings,
  };
}
