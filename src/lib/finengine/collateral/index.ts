/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 5: collateral intelligence
 * (lifecycle-monitored, not a static box). AR eligibility/aging/cross-aging/
 * contra/concentration/government/foreign; inventory NOLV; equipment
 * liquidation; CRE LTV + per-property DSCR; appraisal age; lien/UCC/title;
 * insurance; computed shortfall; guarantor-support-required. Re-testable over
 * the life of the loan. Advance rates resolve from the registry (NG4). Pure.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

// ---- AR eligibility -------------------------------------------------------

export type ArAging = {
  total: number;
  over90: number;
  crossAgedIneligible: number; // accounts >50% past due drag the whole debtor
  contra: number; // offsetting payables
  governmental: number;
  foreign: number;
  /** Largest single-debtor concentration as a fraction of total AR. */
  topDebtorConcentration?: number;
  concentrationCap?: number; // e.g. 0.20
};

export type ArEligibilityResult = { eligible: number; ineligibleBreakdown: Record<string, number>; note: string };

export function computeArEligibility(a: ArAging): ArEligibilityResult {
  const ineligible: Record<string, number> = {
    over90: a.over90,
    crossAged: a.crossAgedIneligible,
    contra: a.contra,
    governmental: a.governmental,
    foreign: a.foreign,
  };
  let eligible = a.total - a.over90 - a.crossAgedIneligible - a.contra - a.governmental - a.foreign;
  // Concentration: amount above the cap on the top debtor is ineligible.
  if (a.topDebtorConcentration != null && a.concentrationCap != null && a.topDebtorConcentration > a.concentrationCap) {
    const excessFrac = a.topDebtorConcentration - a.concentrationCap;
    const concentrationIneligible = a.total * excessFrac;
    ineligible.concentration = concentrationIneligible;
    eligible -= concentrationIneligible;
  }
  return { eligible: Math.max(0, eligible), ineligibleBreakdown: ineligible, note: "Eligible AR = total − (>90 / cross-aged / contra / governmental / foreign / over-concentration)." };
}

// ---- Inventory / equipment ------------------------------------------------

export function computeInventoryNOLV(inventoryCost: number, nolvRate: number): number {
  return inventoryCost * nolvRate;
}

export function computeEquipmentLiquidation(orderlyLiquidationValue: number, forcedRate = 0.8): number {
  return orderlyLiquidationValue * forcedRate;
}

// ---- Collateral position + shortfall --------------------------------------

export type CollateralComponent = {
  type: "AR" | "INVENTORY" | "EQUIPMENT" | "CRE";
  grossValue: number;
  /** Discount/advance rate applied to derive lendable value. */
  advanceRate: number;
};

export type CollateralPositionInput = {
  components: CollateralComponent[];
  loanExposure: number;
  guarantorLiquidity?: number;
};

export type CollateralPosition = {
  grossValue: number;
  discountedValue: number;
  coverageRatio: number | null;
  shortfall: number; // positive => uncovered exposure
  guarantorSupportRequired: boolean;
  guarantorSupportSufficient: boolean | null;
  note: string;
};

export function computeCollateralPosition(i: CollateralPositionInput): CollateralPosition {
  const grossValue = i.components.reduce((s, c) => s + c.grossValue, 0);
  const discountedValue = i.components.reduce((s, c) => s + c.grossValue * c.advanceRate, 0);
  const coverageRatio = i.loanExposure > 0 ? discountedValue / i.loanExposure : null;
  const shortfall = Math.max(0, i.loanExposure - discountedValue);
  const guarantorSupportRequired = shortfall > 0;
  const guarantorSupportSufficient =
    guarantorSupportRequired && i.guarantorLiquidity != null ? i.guarantorLiquidity >= shortfall : guarantorSupportRequired ? null : true;
  return {
    grossValue,
    discountedValue,
    coverageRatio,
    shortfall,
    guarantorSupportRequired,
    guarantorSupportSufficient,
    note: `Discounted collateral ${Math.round(discountedValue).toLocaleString("en-US")} vs exposure ${Math.round(i.loanExposure).toLocaleString("en-US")}; shortfall ${Math.round(shortfall).toLocaleString("en-US")}.`,
  };
}

/** Default AR/inventory advance components built from the registry. */
export function arInventoryComponents(eligibleAR: number, inventoryNOLV: number, ctx?: PolicyContext): CollateralComponent[] {
  return [
    { type: "AR", grossValue: eligibleAR, advanceRate: resolvePolicy("advance_rate_ar", ctx).effective ?? 0.8 },
    { type: "INVENTORY", grossValue: inventoryNOLV, advanceRate: resolvePolicy("advance_rate_inv", ctx).effective ?? 0.5 },
  ];
}

// ---- Lifecycle monitoring (re-testable) -----------------------------------

export type CollateralMonitoringState = {
  appraisalAgeMonths: number;
  lienPerfected: boolean;
  uccFiled: boolean;
  insuranceAdequate: boolean;
  perPropertyDscr?: number | null;
};

export type CollateralMonitoringResult = { healthy: boolean; flags: string[] };

/** Re-testable lifecycle check — runs at origination AND over the loan's life. */
export function monitorCollateral(s: CollateralMonitoringState, maxAppraisalAgeMonths = 24): CollateralMonitoringResult {
  const flags: string[] = [];
  if (s.appraisalAgeMonths > maxAppraisalAgeMonths) flags.push(`Appraisal stale (${s.appraisalAgeMonths}mo > ${maxAppraisalAgeMonths}mo).`);
  if (!s.lienPerfected) flags.push("Lien not perfected.");
  if (!s.uccFiled) flags.push("UCC not filed.");
  if (!s.insuranceAdequate) flags.push("Insurance coverage inadequate.");
  if (s.perPropertyDscr != null && s.perPropertyDscr < 1.0) flags.push(`Per-property DSCR ${s.perPropertyDscr.toFixed(2)}x < 1.00x.`);
  return { healthy: flags.length === 0, flags };
}
