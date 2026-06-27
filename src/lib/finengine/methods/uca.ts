/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 2: UCA (Uniform Credit Analysis)
 * cash flow. Traces operating cash by adjusting net income for non-cash charges
 * and changes in working capital (AR, inventory, AP). Where working-capital
 * change facts are absent it degrades to net income + D&A and warns. Pure.
 */

import type { CashFlowMethod, CashFlowResult, SpreadInputs, ProductProfile } from "@/lib/finengine/contracts";

const n = (v: number | null | undefined): number | null => (v == null ? null : v);

export const ucaMethod: CashFlowMethod = {
  id: "UCA",
  appliesTo(profile: ProductProfile): boolean {
    return profile.eligibleMethods.includes("UCA");
  },
  compute(inputs: SpreadInputs): CashFlowResult {
    const f = inputs.facts;
    const netIncome = n(f["NET_INCOME"]) ?? n(f["ORDINARY_BUSINESS_INCOME"]) ?? n(f["TAXABLE_INCOME"]);
    const dep = n(f["DEPRECIATION"]) ?? 0;
    const amort = n(f["AMORTIZATION"]) ?? 0;

    // Working-capital changes (sources/uses). A rise in AR/inventory uses cash;
    // a rise in AP provides cash.
    const dAR = n(f["AR_CHANGE"]);
    const dInv = n(f["INVENTORY_CHANGE"]);
    const dAP = n(f["AP_CHANGE"]);
    const warnings: string[] = [];
    let wcAdjustment = 0;
    let wcKnown = false;
    if (dAR != null) { wcAdjustment -= dAR; wcKnown = true; }
    if (dInv != null) { wcAdjustment -= dInv; wcKnown = true; }
    if (dAP != null) { wcAdjustment += dAP; wcKnown = true; }
    if (!wcKnown) warnings.push("No working-capital change facts (AR/inventory/AP) — UCA degraded to net income + D&A.");

    const cashFlowAvailable = netIncome == null ? null : netIncome + dep + amort + wcAdjustment;

    return {
      method: "UCA",
      cashFlowAvailable,
      base: { key: "NET_INCOME", label: "Net income", value: netIncome },
      adjustments: [
        { key: "DEP_AMORT", label: "Depreciation & amortization (non-cash)", amount: dep + amort, category: "ADD_BACK", recurring: true, defensibility: 0.95 },
        { key: "WORKING_CAPITAL", label: "Change in working capital", amount: wcAdjustment, category: "NORMALIZATION", recurring: true, defensibility: wcKnown ? 0.85 : 0.4 },
      ],
      explanation: "UCA = net income + non-cash charges ± change in working capital (AR/inventory/AP).",
      warnings,
    };
  },
};
