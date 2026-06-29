/**
 * Financial Intelligence Layer — EBITDA Engine
 *
 * Computes adjusted EBITDA from extracted financial facts with standard
 * add-backs, partnership-specific items, and non-recurring adjustments.
 * Pure function — no DB, no server-only.
 *
 * SPEC-B4: Optional methodologySlate parameter controls which add-backs
 * are included. When omitted, uses "standard" (all add-backs — matches
 * pre-B4 behavior).
 */

import type { MethodologySlate } from "@/lib/methodology/types";
import { resolveEbitdaBaseIncome } from "@/lib/financialIntelligence/ebitdaBase";

export type EbitdaAddBack = {
  key: string;
  label: string;
  value: number;
  source: "EXTRACTED" | "COMPUTED" | "ESTIMATED";
  notes: string;
};

export type EbitdaAnalysis = {
  reportedOBI: number | null;
  /**
   * SPEC-CANONICAL-DSCR-NCADS-PERFECTION-PROGRAM-1 Phase 1: the base income used
   * for EBITDA. Pass-throughs use ORDINARY_BUSINESS_INCOME; C-corps (Form 1120,
   * no OBI) use pre-tax TAXABLE_INCOME, or NET_INCOME reconstructed to pre-tax.
   */
  baseKey: "ORDINARY_BUSINESS_INCOME" | "TAXABLE_INCOME" | "M1_TAXABLE_INCOME" | "NET_INCOME" | null;
  baseLabel: string;
  baseValue: number | null;
  addBacks: EbitdaAddBack[];
  adjustedEbitda: number | null;
  adjustedEbitdaComponents: string;
  warnings: string[];
};

type FactMap = Record<string, number | null>;

function val(facts: FactMap, key: string): number | null {
  const v = facts[key];
  return v === undefined ? null : v;
}

function fmt(n: number): string {
  return n < 0 ? `-$${Math.abs(n).toLocaleString("en-US")}` : `$${n.toLocaleString("en-US")}`;
}

export function computeEbitda(
  facts: FactMap,
  formType: string,
  methodologySlate?: MethodologySlate,
): EbitdaAnalysis {
  const reportedOBI = val(facts, "ORDINARY_BUSINESS_INCOME");
  const addBacks: EbitdaAddBack[] = [];
  const warnings: string[] = [];

  // SPEC-EBITDA-BASE-INCOME-WIRE-1: the base-income selection ladder now lives in
  // the shared resolveEbitdaBaseIncome resolver (extracted verbatim) so the live
  // spread and this engine share one policy. Output is byte-identical: the
  // resolver's taxAddBack/warning are translated back into the same add-back push
  // and warning that the inline ladder produced.
  const base = resolveEbitdaBaseIncome(facts);
  const baseKey: EbitdaAnalysis["baseKey"] = base.baseKey;
  const baseLabel = base.baseLabel;
  const baseValue: number | null = base.baseValue;
  if (base.taxAddBack !== null) {
    addBacks.push({
      key: "TAX_PROVISION",
      label: "Federal Tax Provision (reconstruct pre-tax base)",
      value: base.taxAddBack.value,
      source: "EXTRACTED",
      notes: "C-corp EBITDA base reconstructed from after-tax NET_INCOME by adding the tax provision back to pre-tax.",
    });
  }
  if (base.warning !== null) {
    warnings.push(base.warning);
  }

  // SPEC-B4: determine add-back stack variant
  const addBackVariant = methodologySlate?.ebitda_addback_stack ?? "standard";

  // --- Core add-backs (included in all variants) ---

  const interest = val(facts, "INTEREST_EXPENSE");
  if (interest !== null && interest !== 0) {
    addBacks.push({
      key: "INTEREST_EXPENSE",
      label: "Interest Expense",
      value: interest,
      source: "EXTRACTED",
      notes: "",
    });
  }

  const depreciation = val(facts, "DEPRECIATION");
  if (depreciation !== null && depreciation !== 0) {
    addBacks.push({
      key: "DEPRECIATION",
      label: "Depreciation & Amortization",
      value: depreciation,
      source: "EXTRACTED",
      notes: "",
    });
  }

  const amortization = val(facts, "AMORTIZATION");
  if (amortization !== null && amortization !== 0) {
    addBacks.push({
      key: "AMORTIZATION",
      label: "Amortization",
      value: amortization,
      source: "EXTRACTED",
      notes: "",
    });
  }

  // --- Expanded add-backs (standard + aggressive only, NOT conservative) ---

  if (addBackVariant !== "conservative") {
    const s179 = val(facts, "SECTION_179_EXPENSE");
    if (s179 !== null && s179 !== 0) {
      addBacks.push({
        key: "SECTION_179_EXPENSE",
        label: "Section 179 Expense",
        value: s179,
        source: "EXTRACTED",
        notes: "",
      });
    }

    const bonusDepr = val(facts, "BONUS_DEPRECIATION");
    if (bonusDepr !== null && bonusDepr !== 0) {
      addBacks.push({
        key: "BONUS_DEPRECIATION",
        label: "Bonus Depreciation",
        value: bonusDepr,
        source: "EXTRACTED",
        notes: "",
      });
    }
  }

  // --- Partnership-specific ---

  if (formType === "FORM_1065") {
    const gp = val(facts, "GUARANTEED_PAYMENTS");
    if (gp !== null && gp !== 0) {
      addBacks.push({
        key: "GUARANTEED_PAYMENTS",
        label: "Guaranteed Payments to Partners",
        value: gp,
        source: "EXTRACTED",
        notes:
          "Treated as officer compensation equivalent — added back to normalize",
      });
    }
  }

  // --- Non-recurring (standard + aggressive only, NOT conservative) ---

  if (addBackVariant !== "conservative") {
    const nrExpense = val(facts, "NON_RECURRING_EXPENSE");
    if (nrExpense !== null && nrExpense !== 0) {
      addBacks.push({
        key: "NON_RECURRING_EXPENSE",
        label: "Non-Recurring Expense Add-Back",
        value: nrExpense,
        source: "EXTRACTED",
        notes: "",
      });
    }

    const nrIncome = val(facts, "NON_RECURRING_INCOME");
    if (nrIncome !== null && nrIncome !== 0) {
      addBacks.push({
        key: "NON_RECURRING_INCOME",
        label: "Non-Recurring Income Deduction",
        value: -nrIncome,
        source: "EXTRACTED",
        notes: "",
      });
    }
  }

  // --- Interest-in-COGS detection ---

  const cogs = val(facts, "COST_OF_GOODS_SOLD");
  if (cogs !== null && cogs > 0 && interest === null) {
    warnings.push(
      "COGS present but no separate interest line detected. For maritime, construction, or real estate industries, interest may be embedded in COGS. Verify Form 1125-A.",
    );
  }

  // --- Compute adjusted EBITDA ---

  let adjustedEbitda: number | null = null;
  let adjustedEbitdaComponents = "";

  if (baseValue !== null) {
    const positiveSum = addBacks
      .filter((ab) => ab.value > 0)
      .reduce((s, ab) => s + ab.value, 0);
    const negativeSum = addBacks
      .filter((ab) => ab.value < 0)
      .reduce((s, ab) => s + ab.value, 0);

    adjustedEbitda = baseValue + positiveSum + negativeSum;

    // Build human-readable formula
    const parts = [`${baseLabel} ${fmt(baseValue)}`];
    for (const ab of addBacks) {
      if (ab.value > 0) {
        parts.push(`+ ${ab.label} ${fmt(ab.value)}`);
      } else {
        parts.push(`- ${ab.label} ${fmt(Math.abs(ab.value))}`);
      }
    }
    parts.push(`= ${fmt(adjustedEbitda)}`);
    adjustedEbitdaComponents = parts.join(" ");
  }

  return {
    reportedOBI,
    baseKey,
    baseLabel,
    baseValue,
    addBacks,
    adjustedEbitda,
    adjustedEbitdaComponents,
    warnings,
  };
}
