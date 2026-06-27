/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 2: CRE NOI method. Net operating
 * income for income-producing real estate: NOI_TTM if present, else total
 * income − operating expenses (TTM). This is the repayment basis for CRE
 * products (property_noi). Pure.
 */

import type { CashFlowMethod, CashFlowResult, SpreadInputs, ProductProfile } from "@/lib/finengine/contracts";

const n = (v: number | null | undefined): number | null => (v == null ? null : v);

export const creNoiMethod: CashFlowMethod = {
  id: "CRE_NOI",
  appliesTo(profile: ProductProfile): boolean {
    return profile.eligibleMethods.includes("CRE_NOI");
  },
  compute(inputs: SpreadInputs): CashFlowResult {
    const f = inputs.facts;
    const noiDirect = n(f["NOI_TTM"]) ?? n(f["NOI"]);
    const income = n(f["TOTAL_INCOME_TTM"]);
    const opex = n(f["OPEX_TTM"]);
    const warnings: string[] = [];

    let noi: number | null;
    let basis: string;
    if (noiDirect != null) {
      noi = noiDirect;
      basis = "NOI_TTM (direct)";
    } else if (income != null && opex != null) {
      noi = income - opex;
      basis = "TOTAL_INCOME_TTM − OPEX_TTM";
    } else {
      noi = null;
      basis = "unavailable";
      warnings.push("No NOI_TTM and insufficient income/opex facts to derive NOI.");
    }

    return {
      method: "CRE_NOI",
      cashFlowAvailable: noi,
      base: { key: "NOI_TTM", label: "Net operating income (TTM)", value: noi },
      adjustments: [],
      explanation: `CRE NOI = ${basis}.`,
      warnings,
    };
  },
};
