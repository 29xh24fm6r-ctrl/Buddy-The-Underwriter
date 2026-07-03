/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 10: Construction Loan Intelligence.
 *
 * Validates a construction credit: sources & uses balance, budget sufficiency,
 * contingency & interest-reserve adequacy, equity injection, retainage, draw
 * schedule, permit checklist, completion guaranty, and a cost-overrun stress.
 * Pure + deterministic. Emits approval-conditions and missing-items; it never
 * writes and never approves.
 */

export type LineItem = { label: string; amount: number };

export type PermitItem = { name: string; obtained: boolean };

export type ConstructionInput = {
  sources: LineItem[];
  uses: LineItem[];
  loanAmount: number;
  equityAmount: number;
  /** Cost components (used for adequacy tests). */
  hardCosts: number;
  softCosts: number;
  contingency: number;
  interestReserve: number;
  landCost?: number;
  /** Interest the reserve must carry over the build. */
  projectedInterestCost?: number;
  drawSchedule?: { month: number; amount: number }[];
  retainagePct?: number;
  completionGuarantyProvided?: boolean;
  permits?: PermitItem[];
  /** Cost-overrun scenario as a fraction of hard costs (e.g. 0.10). */
  costOverrunStressPct?: number;
};

/** Minimum contingency as a fraction of hard costs (policy default). */
export const MIN_CONTINGENCY_PCT = 0.05;
/** Minimum required retainage on hard-cost draws (policy default). */
export const MIN_RETAINAGE_PCT = 0.1;
/** Below this equity share, a completion guaranty is required. */
export const COMPLETION_GUARANTY_EQUITY_THRESHOLD = 0.25;

export type CostOverrunStress = {
  overrunAmount: number;
  absorbedByContingency: number;
  fundingShortfall: number;
  stressedLtc: number | null;
};

export type ConstructionAnalysis = {
  sourcesTotal: number;
  usesTotal: number;
  inBalance: boolean;
  imbalance: number;
  totalProjectCost: number;
  ltc: number | null;
  equityPct: number | null;
  contingencyPct: number | null;
  contingencyAdequate: boolean;
  interestReserveAdequate: boolean | null;
  retainageAdequate: boolean | null;
  completionGuarantyRequired: boolean;
  completionGuarantySatisfied: boolean;
  missingPermits: string[];
  costOverrunStress: CostOverrunStress | null;
  approvalConditions: string[];
  missingItems: string[];
  blockers: string[];
};

const sum = (items: LineItem[]) => items.reduce((s, i) => s + i.amount, 0);

export function analyzeConstructionLoan(input: ConstructionInput): ConstructionAnalysis {
  const approvalConditions: string[] = [];
  const missingItems: string[] = [];
  const blockers: string[] = [];

  const sourcesTotal = sum(input.sources);
  const usesTotal = sum(input.uses);
  const imbalance = sourcesTotal - usesTotal;
  const inBalance = Math.abs(imbalance) < 1; // to the dollar
  if (!inBalance) {
    blockers.push(imbalance < 0 ? "sources_and_uses_underfunded" : "sources_exceed_uses");
  }

  const totalProjectCost = usesTotal;
  const ltc = totalProjectCost > 0 ? input.loanAmount / totalProjectCost : null;
  const equityPct = totalProjectCost > 0 ? input.equityAmount / totalProjectCost : null;

  // Contingency adequacy vs hard costs.
  const contingencyPct = input.hardCosts > 0 ? input.contingency / input.hardCosts : null;
  const contingencyAdequate = contingencyPct != null && contingencyPct >= MIN_CONTINGENCY_PCT;
  if (!contingencyAdequate) {
    blockers.push("insufficient_contingency");
    approvalConditions.push(`Increase contingency to ≥${MIN_CONTINGENCY_PCT * 100}% of hard costs`);
  }

  // Interest reserve adequacy.
  let interestReserveAdequate: boolean | null = null;
  if (input.projectedInterestCost != null) {
    interestReserveAdequate = input.interestReserve >= input.projectedInterestCost;
    if (!interestReserveAdequate) {
      blockers.push("insufficient_interest_reserve");
      approvalConditions.push("Fund interest reserve to cover projected construction-period interest");
    }
  } else {
    missingItems.push("projected_interest_cost");
  }

  // Retainage.
  let retainageAdequate: boolean | null = null;
  if (input.retainagePct != null) {
    retainageAdequate = input.retainagePct >= MIN_RETAINAGE_PCT;
    if (!retainageAdequate) approvalConditions.push(`Hold retainage of ≥${MIN_RETAINAGE_PCT * 100}% on hard-cost draws`);
  } else {
    missingItems.push("retainage_terms");
  }

  // Completion guaranty required when equity is thin.
  const completionGuarantyRequired = equityPct == null || equityPct < COMPLETION_GUARANTY_EQUITY_THRESHOLD;
  const completionGuarantySatisfied = !completionGuarantyRequired || !!input.completionGuarantyProvided;
  if (completionGuarantyRequired && !input.completionGuarantyProvided) {
    approvalConditions.push("Obtain completion guaranty from creditworthy guarantor");
  }

  // Permit / entitlement checklist.
  const missingPermits = (input.permits ?? []).filter((p) => !p.obtained).map((p) => p.name);
  if (!input.permits || input.permits.length === 0) missingItems.push("permit_entitlement_checklist");
  if (missingPermits.length > 0) approvalConditions.push(`Obtain permits prior to funding: ${missingPermits.join(", ")}`);

  // Draw schedule.
  if (!input.drawSchedule || input.drawSchedule.length === 0) missingItems.push("draw_schedule");

  // Cost-overrun stress.
  let costOverrunStress: CostOverrunStress | null = null;
  if (input.costOverrunStressPct != null) {
    const overrunAmount = input.hardCosts * input.costOverrunStressPct;
    const absorbedByContingency = Math.min(overrunAmount, input.contingency);
    const fundingShortfall = Math.max(0, overrunAmount - input.contingency);
    const stressedLtc =
      totalProjectCost > 0 ? input.loanAmount / (totalProjectCost + fundingShortfall) : null;
    costOverrunStress = { overrunAmount, absorbedByContingency, fundingShortfall, stressedLtc };
    if (fundingShortfall > 0) {
      approvalConditions.push("Identify additional equity/guaranty to cover modeled cost overrun beyond contingency");
    }
  }

  return {
    sourcesTotal,
    usesTotal,
    inBalance,
    imbalance,
    totalProjectCost,
    ltc,
    equityPct,
    contingencyPct,
    contingencyAdequate,
    interestReserveAdequate,
    retainageAdequate,
    completionGuarantyRequired,
    completionGuarantySatisfied,
    missingPermits,
    costOverrunStress,
    approvalConditions,
    missingItems,
    blockers,
  };
}
