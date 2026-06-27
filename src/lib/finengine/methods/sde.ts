/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 2: SDE (Seller's Discretionary
 * Earnings). SDE adds back the FULL owner-compensation package (vs. Adjusted
 * EBITDA, which adds back only the excess over a replacement manager). The
 * difference between the two equals the replacement-manager salary. Pure.
 */

import type { CashFlowMethod, CashFlowResult, SpreadInputs, ProductProfile } from "@/lib/finengine/contracts";
import { coreOperatingEarnings, fullOwnerComp, section179Acceleration } from "@/lib/finengine/methods/foundation";

export const sdeMethod: CashFlowMethod = {
  id: "SDE",
  appliesTo(profile: ProductProfile): boolean {
    return profile.eligibleMethods.includes("SDE");
  },
  compute(inputs: SpreadInputs): CashFlowResult {
    const core = coreOperatingEarnings(inputs);
    const oc = fullOwnerComp(inputs);
    const s179 = section179Acceleration(inputs.facts);

    const cashFlowAvailable = core.value == null ? null : core.value + oc.amount + s179.amount;

    return {
      method: "SDE",
      cashFlowAvailable,
      base: core.base,
      adjustments: [
        { key: "INTEREST_DEP_AMORT", label: "Interest + D&A", amount: core.interest + core.depAmort, category: "ADD_BACK", recurring: true, defensibility: 0.95 },
        { key: "FULL_OWNER_COMP", label: "Full owner-compensation package", amount: oc.amount, category: "ADD_BACK", recurring: true, defensibility: 0.7, notes: oc.note },
        { key: "S179_ACCELERATION", label: "§179 acceleration above straight-line", amount: s179.amount, category: "ADD_BACK", recurring: false, defensibility: 0.7, notes: s179.note },
      ],
      explanation: `SDE = ${core.base.label} + interest + D&A + full owner comp (${Math.round(oc.amount).toLocaleString("en-US")}) + §179 acceleration. Replacement-manager salary is the SDE−AdjEBITDA gap.`,
      warnings: core.value == null ? ["No EBITDA base available."] : [],
    };
  },
};
