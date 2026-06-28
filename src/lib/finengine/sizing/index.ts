/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 5: loan sizing constraints.
 *
 * "Most-restrictive-of" sizing per product: the binding constraint sets the
 * maximum loan. CRE binds on LTV / DSCR / debt yield; ABL + Working CAPLine on
 * the borrowing base; 504 on the 50/40/10 stack + occupancy; acquisition on
 * combined normalized earnings + injection + seller-note standby. Advance rates,
 * occupancy and equity injection resolve from the policy registry (NG4). Pure.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export type SizingConstraint = { name: string; maxLoan: number | null; note: string };
export type SizingResult = {
  constraints: SizingConstraint[];
  bindingConstraint: SizingConstraint | null;
  maxLoan: number | null;
};

/** The most-restrictive (lowest) max-loan across all binding constraints. */
export function mostRestrictiveOf(constraints: SizingConstraint[]): SizingResult {
  const valid = constraints.filter((c): c is SizingConstraint & { maxLoan: number } => c.maxLoan != null);
  if (valid.length === 0) return { constraints, bindingConstraint: null, maxLoan: null };
  const binding = valid.reduce((a, b) => (b.maxLoan < a.maxLoan ? b : a));
  return { constraints, bindingConstraint: binding, maxLoan: binding.maxLoan };
}

// ---- CRE: LTV / DSCR / debt-yield -----------------------------------------

export type CreSizingInputs = {
  propertyValue: number;
  noi: number;
  annualConstantRate: number; // mortgage constant (P&I per $1 of loan, annual)
  ctx?: PolicyContext;
  minDebtYield?: number; // e.g. 0.09
};

export function sizeCre(i: CreSizingInputs): SizingResult {
  const ltvCap = resolvePolicy("ltv_max", i.ctx).effective ?? 0.75;
  const dscrFloor = resolvePolicy("dscr_floor", i.ctx).effective ?? 1.2;

  const byLtv = i.propertyValue * ltvCap;
  // Max debt service the NOI supports at the DSCR floor; loan = DS / constant.
  const maxDebtService = i.noi / dscrFloor;
  const byDscr = i.annualConstantRate > 0 ? maxDebtService / i.annualConstantRate : null;
  const byDebtYield = i.minDebtYield && i.minDebtYield > 0 ? i.noi / i.minDebtYield : null;

  return mostRestrictiveOf([
    { name: "LTV", maxLoan: byLtv, note: `value × LTV cap ${(ltvCap * 100).toFixed(0)}%` },
    { name: "DSCR", maxLoan: byDscr, note: `NOI ÷ DSCR floor ${dscrFloor.toFixed(2)}x ÷ constant` },
    { name: "DEBT_YIELD", maxLoan: byDebtYield, note: i.minDebtYield ? `NOI ÷ ${(i.minDebtYield * 100).toFixed(0)}% min debt yield` : "n/a" },
  ]);
}

// ---- ABL / Working CAPLine: borrowing base --------------------------------

export type BorrowingBaseInputs = {
  eligibleAR: number;
  eligibleInventoryNOLV: number;
  ctx?: PolicyContext;
};

export function sizeBorrowingBase(i: BorrowingBaseInputs): SizingResult {
  const arRate = resolvePolicy("advance_rate_ar", i.ctx).effective ?? 0.8;
  const invRate = resolvePolicy("advance_rate_inv", i.ctx).effective ?? 0.5;
  const arAvail = i.eligibleAR * arRate;
  const invAvail = i.eligibleInventoryNOLV * invRate;
  const base = arAvail + invAvail;
  return {
    constraints: [
      { name: "AR_ADVANCE", maxLoan: arAvail, note: `eligible AR × ${(arRate * 100).toFixed(0)}%` },
      { name: "INV_ADVANCE", maxLoan: invAvail, note: `eligible inventory NOLV × ${(invRate * 100).toFixed(0)}%` },
    ],
    bindingConstraint: { name: "BORROWING_BASE", maxLoan: base, note: "sum of AR + inventory availability" },
    maxLoan: base,
  };
}

/**
 * CAPLine sizing. Contract CAPLine = sum of contract costs OR 20% over the
 * greatest projected deficit (the more supportive); Seasonal = off projected
 * peak AR/inventory need.
 */
export function sizeCapLine(args: {
  type: "contract" | "seasonal";
  contractCosts?: number;
  greatestProjectedDeficit?: number;
  projectedPeakNeed?: number;
}): SizingResult {
  if (args.type === "contract") {
    const a = args.contractCosts ?? 0;
    const b = (args.greatestProjectedDeficit ?? 0) * 1.2; // 20% over the deficit
    const maxLoan = Math.max(a, b);
    return {
      constraints: [
        { name: "CONTRACT_COSTS", maxLoan: a, note: "sum of contract costs" },
        { name: "DEFICIT_PLUS_20", maxLoan: b, note: "120% of greatest projected deficit" },
      ],
      bindingConstraint: { name: "CAPLINE_CONTRACT", maxLoan, note: "greater of contract costs or 120% of deficit" },
      maxLoan,
    };
  }
  const maxLoan = args.projectedPeakNeed ?? null;
  return {
    constraints: [{ name: "SEASONAL_PEAK", maxLoan, note: "projected peak AR/inventory need" }],
    bindingConstraint: maxLoan == null ? null : { name: "CAPLINE_SEASONAL", maxLoan, note: "projected seasonal peak" },
    maxLoan,
  };
}

// ---- 504: 50/40/10 stack + occupancy + special-purpose overlay ------------

export type Sba504Inputs = {
  totalProjectCost: number;
  isSpecialPurpose?: boolean;
  isNewBusinessOrSingleUse?: boolean;
  occupancyPct: number;
  ctx?: PolicyContext;
};

export function size504(i: Sba504Inputs): { bankFirst: number; cdcSecond: number; equity: number; equityPct: number; occupancyOk: boolean; note: string } {
  const occMin = resolvePolicy("occupancy_min", { ...i.ctx, productId: "SBA_504" }).effective ?? 0.51;
  // Base 10% equity; +5% for special-purpose OR new/single-use; +10% if BOTH.
  let equityPct = resolvePolicy("equity_injection_min", i.ctx).effective ?? 0.1;
  if (i.isSpecialPurpose) equityPct += 0.05;
  if (i.isNewBusinessOrSingleUse) equityPct += 0.05;
  const equity = i.totalProjectCost * equityPct;
  const bankFirst = i.totalProjectCost * 0.5; // 50% bank first
  const cdcSecond = i.totalProjectCost - bankFirst - equity; // CDC takes the remainder (~40%)
  return {
    bankFirst,
    cdcSecond,
    equity,
    equityPct,
    occupancyOk: i.occupancyPct >= occMin,
    note: `504 stack: 50% bank first / ${(((cdcSecond / i.totalProjectCost) * 100)).toFixed(0)}% CDC second / ${(equityPct * 100).toFixed(0)}% equity; occupancy ${(i.occupancyPct * 100).toFixed(0)}% vs ${(occMin * 100).toFixed(0)}% min.`,
  };
}

// ---- Acquisition: combined earnings + injection + seller-note standby ------

export function sizeAcquisition(args: {
  buyerNormalizedEbitda: number;
  sellerNormalizedEbitda: number;
  synergies?: number;
  annualConstantRate: number;
  sellerNoteFullStandby?: boolean;
  sellerNoteAmount?: number;
  ctx?: PolicyContext;
}): { combinedEbitda: number; maxDebtService: number; maxLoan: number | null; sellerNoteCountsAsEquity: boolean; note: string } {
  const dscrFloor = resolvePolicy("dscr_floor", { ...args.ctx, productId: "SBA_7A_STANDARD" }).effective ?? 1.15;
  const combinedEbitda = args.buyerNormalizedEbitda + args.sellerNormalizedEbitda + (args.synergies ?? 0);
  const maxDebtService = combinedEbitda / dscrFloor;
  const maxLoan = args.annualConstantRate > 0 ? maxDebtService / args.annualConstantRate : null;
  // A seller note on FULL standby counts toward the equity injection.
  const sellerNoteCountsAsEquity = !!args.sellerNoteFullStandby && (args.sellerNoteAmount ?? 0) > 0;
  return {
    combinedEbitda,
    maxDebtService,
    maxLoan,
    sellerNoteCountsAsEquity,
    note: `Combined normalized EBITDA ÷ DSCR floor ${dscrFloor.toFixed(2)}x ÷ constant. Seller note ${sellerNoteCountsAsEquity ? "on full standby — counts as equity" : "not on full standby"}.`,
  };
}

// ---- Equipment: advance-rate / NOLV sizing + useful-life term gate ---------
// SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream A.

export type EquipmentSizingInputs = {
  equipmentCost: number;
  isNew: boolean;
  /** Net orderly liquidation value (required for used equipment; ignored when new). */
  nolv?: number | null;
  usefulLifeYears?: number | null;
  proposedTermYears?: number | null;
  ctx?: PolicyContext;
};

export type EquipmentSizingResult = SizingResult & {
  /** True when the proposed term outruns the asset's economic life (term > usefulLife × cap). */
  termExceedsUsefulLife: boolean | null;
  termNote: string;
};

/**
 * Equipment sizing: NEW equipment advances against invoice cost; USED equipment
 * advances against net orderly liquidation value (NOLV). The max loan is the
 * single applicable advance (most-restrictive-of degrades to that one leg). A
 * separate STRUCTURAL gate — not a maxLoan — flags when the proposed term
 * outruns the asset's useful life (term > usefulLife × term_to_useful_life_max),
 * since the self-liquidating collateral should outlast the loan. Pure.
 */
export function sizeEquipment(i: EquipmentSizingInputs): EquipmentSizingResult {
  const newRate = resolvePolicy("advance_rate_equipment_new", i.ctx).effective ?? 0.8;
  const usedRate = resolvePolicy("advance_rate_equipment_used_nolv", i.ctx).effective ?? 0.8;
  const termCap = resolvePolicy("term_to_useful_life_max", i.ctx).effective ?? 0.8;

  const constraints: SizingConstraint[] = [];
  if (i.isNew) {
    const byCost = i.equipmentCost > 0 ? i.equipmentCost * newRate : null;
    constraints.push({ name: "EQUIP_COST_ADVANCE", maxLoan: byCost, note: `new equipment cost × ${(newRate * 100).toFixed(0)}% advance` });
  } else {
    const nolv = i.nolv ?? null;
    const byNolv = nolv != null && nolv > 0 ? nolv * usedRate : null;
    constraints.push({ name: "EQUIP_NOLV_ADVANCE", maxLoan: byNolv, note: nolv != null ? `used equipment NOLV × ${(usedRate * 100).toFixed(0)}% advance` : "used equipment requires NOLV — none provided" });
  }

  const sized = mostRestrictiveOf(constraints);

  // Structural useful-life term gate (advisory flag, not a sizing constraint).
  const life = i.usefulLifeYears ?? null;
  const term = i.proposedTermYears ?? null;
  let termExceedsUsefulLife: boolean | null = null;
  let termNote = "useful-life term check skipped (term or useful life not provided)";
  if (life != null && life > 0 && term != null && term > 0) {
    const maxTerm = life * termCap;
    termExceedsUsefulLife = term > maxTerm;
    termNote = termExceedsUsefulLife
      ? `proposed term ${term.toFixed(1)}y EXCEEDS ${(termCap * 100).toFixed(0)}% of ${life.toFixed(1)}y useful life (${maxTerm.toFixed(1)}y) — term outruns asset life`
      : `proposed term ${term.toFixed(1)}y within ${(termCap * 100).toFixed(0)}% of ${life.toFixed(1)}y useful life (${maxTerm.toFixed(1)}y)`;
  }

  return { ...sized, termExceedsUsefulLife, termNote };
}
