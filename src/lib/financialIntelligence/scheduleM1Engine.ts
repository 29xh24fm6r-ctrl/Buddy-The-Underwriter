/**
 * Financial Intelligence Layer — Schedule M-1 Engine
 *
 * Analyzes book-to-tax differences from IRS Schedule M-1 data.
 * Pure function — no DB, no server-only.
 */

export type M1DifferenceItem = {
  item: string;
  bookAmount: number | null;
  taxAmount: number | null;
  delta: number | null;
  direction: "BOOK_HIGHER" | "TAX_HIGHER";
  interpretation: string;
};

export type M1Analysis = {
  bookNetIncome: number | null;
  taxNetIncome: number | null;
  bookTaxDifference: number | null;
  significantDifferences: M1DifferenceItem[];
  ebitdaAdjustment: number | null;
  warnings: string[];
};

type FactMap = Record<string, number | null>;

function val(facts: FactMap, key: string): number | null {
  const v = facts[key];
  return v === undefined ? null : v;
}

export function analyzeScheduleM1(facts: FactMap): M1Analysis {
  const bookNetIncome = val(facts, "M1_NET_INCOME_PER_BOOKS");
  const taxNetIncome = val(facts, "ORDINARY_BUSINESS_INCOME");
  const grossReceipts = val(facts, "GROSS_RECEIPTS");

  const significantDifferences: M1DifferenceItem[] = [];
  const warnings: string[] = [];
  let ebitdaAdjustment: number | null = null;

  // Book-tax difference
  let bookTaxDifference: number | null = null;
  if (bookNetIncome !== null && taxNetIncome !== null) {
    bookTaxDifference = bookNetIncome - taxNetIncome;

    if (Math.abs(bookTaxDifference) > 5000) {
      significantDifferences.push({
        item: "Net Income Book vs Tax",
        bookAmount: bookNetIncome,
        taxAmount: taxNetIncome,
        delta: bookTaxDifference,
        direction: bookTaxDifference > 0 ? "BOOK_HIGHER" : "TAX_HIGHER",
        interpretation:
          bookTaxDifference > 0
            ? "Book income exceeds tax income — temporary or permanent differences present"
            : "Tax income exceeds book income — potential aggressive book accounting",
      });
    }
  }

  // Depreciation timing
  const depreciationTiming = val(facts, "M1_DEPRECIATION_TIMING");
  if (depreciationTiming !== null) {
    significantDifferences.push({
      item: "Depreciation Timing Difference",
      bookAmount: null,
      taxAmount: depreciationTiming,
      delta: depreciationTiming,
      direction: depreciationTiming > 0 ? "TAX_HIGHER" : "BOOK_HIGHER",
      interpretation:
        "Timing difference — accelerated tax depreciation vs book depreciation",
    });
    // Depreciation timing may indicate additional non-cash expense
    ebitdaAdjustment = (ebitdaAdjustment ?? 0) + Math.abs(depreciationTiming);
  }

  // Meals & entertainment
  const mealsEnt = val(facts, "M1_MEALS_ENTERTAINMENT");
  if (mealsEnt !== null) {
    significantDifferences.push({
      item: "Meals & Entertainment",
      bookAmount: mealsEnt,
      taxAmount: null,
      delta: mealsEnt,
      direction: "BOOK_HIGHER",
      interpretation:
        "Meals & entertainment — 50% non-deductible for tax, fully expensed on books",
    });
  }

  // Revenue-relative warning
  if (
    bookTaxDifference !== null &&
    grossReceipts !== null &&
    grossReceipts > 0 &&
    Math.abs(bookTaxDifference) > grossReceipts * 0.10
  ) {
    warnings.push(
      "Book-to-tax difference exceeds 10% of revenue. Verify income recognition method.",
    );
  }

  return {
    bookNetIncome,
    taxNetIncome,
    bookTaxDifference,
    significantDifferences,
    ebitdaAdjustment,
    warnings,
  };
}
