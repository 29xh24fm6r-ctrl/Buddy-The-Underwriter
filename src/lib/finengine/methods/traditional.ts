/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 2: Traditional debt-coverage
 * cash flow. The classic add-back: pre-tax base income + interest + D&A, with
 * NO discretionary / owner-comp / §179 normalization. This is the conservative
 * floor the other methods are reconciled against. Pure.
 */

import type { CashFlowMethod, CashFlowResult, SpreadInputs, ProductProfile } from "@/lib/finengine/contracts";
import { coreOperatingEarnings } from "@/lib/finengine/methods/foundation";

export const traditionalMethod: CashFlowMethod = {
  id: "TRADITIONAL",
  appliesTo(profile: ProductProfile): boolean {
    return profile.eligibleMethods.includes("TRADITIONAL");
  },
  compute(inputs: SpreadInputs): CashFlowResult {
    const core = coreOperatingEarnings(inputs);
    return {
      method: "TRADITIONAL",
      cashFlowAvailable: core.value,
      base: core.base,
      adjustments: [
        { key: "INTEREST_DEP_AMORT", label: "Interest + D&A", amount: core.interest + core.depAmort, category: "ADD_BACK", recurring: true, defensibility: 0.95 },
      ],
      explanation: `Traditional coverage = ${core.base.label} + interest + D&A (no discretionary or owner-comp normalization).`,
      warnings: core.value == null ? ["No EBITDA base available."] : [],
    };
  },
};
