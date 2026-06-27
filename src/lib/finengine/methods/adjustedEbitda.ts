/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 2: Adjusted EBITDA method.
 *
 * Entity-form-aware EBITDA (C-corp from pre-tax taxable income, pass-throughs
 * from ordinary business income — via the existing computeEbitda), normalized
 * by the OWNER-COMP EXCESS over a market replacement manager (never the full
 * package) and the §179 ACCELERATION only. Pure.
 */

import type { CashFlowMethod, CashFlowResult, SpreadInputs, ProductProfile } from "@/lib/finengine/contracts";
import { coreOperatingEarnings, ownerCompExcess, section179Acceleration } from "@/lib/finengine/methods/foundation";

export const adjustedEbitdaMethod: CashFlowMethod = {
  id: "ADJ_EBITDA",
  appliesTo(profile: ProductProfile): boolean {
    return profile.eligibleMethods.includes("ADJ_EBITDA");
  },
  compute(inputs: SpreadInputs): CashFlowResult {
    const core = coreOperatingEarnings(inputs);
    const oc = ownerCompExcess(inputs);
    const s179 = section179Acceleration(inputs.facts);

    const adjustments = [
      { key: "INTEREST_DEP_AMORT", label: "Interest + D&A (conservative)", amount: core.interest + core.depAmort, category: "ADD_BACK" as const, recurring: true, defensibility: 0.95 },
      { key: "OWNER_COMP_EXCESS", label: "Owner comp excess over replacement", amount: oc.amount, category: "NORMALIZATION" as const, recurring: true, defensibility: 0.8, notes: oc.note },
      { key: "S179_ACCELERATION", label: "§179 acceleration above straight-line", amount: s179.amount, category: "ADD_BACK" as const, recurring: false, defensibility: 0.7, notes: s179.note },
    ].filter((a) => a.amount !== 0 || a.key === "INTEREST_DEP_AMORT");

    const cashFlowAvailable =
      core.value == null ? null : core.value + oc.amount + s179.amount;

    const warnings: string[] = [];
    if (core.value == null) warnings.push("No EBITDA base available (no OBI / TAXABLE_INCOME / NET_INCOME).");

    return {
      method: "ADJ_EBITDA",
      cashFlowAvailable,
      base: core.base,
      adjustments,
      explanation: `Adjusted EBITDA = ${core.base.label} + interest + D&A + owner-comp excess (${Math.round(oc.amount).toLocaleString("en-US")}) + §179 acceleration (${Math.round(s179.amount).toLocaleString("en-US")}).`,
      warnings,
    };
  },
};
