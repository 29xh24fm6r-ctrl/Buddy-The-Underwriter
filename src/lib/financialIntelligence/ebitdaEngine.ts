/**
 * Financial Intelligence Layer — EBITDA Engine
 *
 * Computes adjusted EBITDA from extracted financial facts with standard
 * add-backs, partnership-specific items, and non-recurring adjustments.
 * Pure function — no DB, no server-only.
 */

export type EbitdaAddBack = {
  key: string;
  label: string;
  value: number;
  source: "EXTRACTED" | "COMPUTED" | "ESTIMATED";
  notes: string;
};

export type EbitdaAnalysis = {
  reportedOBI: number | null;
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
): EbitdaAnalysis {
  const reportedOBI = val(facts, "ORDINARY_BUSINESS_INCOME");
  const addBacks: EbitdaAddBack[] = [];
  const warnings: string[] = [];

  // --- Standard add-backs ---

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

  // --- Non-recurring ---

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

  if (reportedOBI !== null) {
    const positiveSum = addBacks
      .filter((ab) => ab.value > 0)
      .reduce((s, ab) => s + ab.value, 0);
    const negativeSum = addBacks
      .filter((ab) => ab.value < 0)
      .reduce((s, ab) => s + ab.value, 0);

    adjustedEbitda = reportedOBI + positiveSum + negativeSum;

    // Build human-readable formula
    const parts = [`OBI ${fmt(reportedOBI)}`];
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
    addBacks,
    adjustedEbitda,
    adjustedEbitdaComponents,
    warnings,
  };
}
