/**
 * Quality of Earnings Engine — God Tier Phase 2, Layer 2
 *
 * Identifies non-recurring items, computes adjusted EBITDA,
 * and produces a QualityOfEarningsReport.
 * Pure function — no DB, no server imports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QoEAdjustment = {
  lineItem: string;
  amount: number;
  direction: "add_back" | "deduct";
  classification:
    | "non_recurring_income"
    | "non_recurring_expense"
    | "owner_benefit"
    | "normalization";
  source: string;
  documentationRequired: boolean;
  autoApproved: boolean;
};

export type QoEConfidence = "high" | "medium" | "low";

export type QualityOfEarningsReport = {
  reportedEbitda: number;
  adjustments: QoEAdjustment[];
  adjustedEbitda: number;
  adjustmentTotal: number;
  confidence: QoEConfidence;
};

export type QoELineItem = {
  label: string;
  amount: number;
  source: string;
};

export type QoEInput = {
  reportedEbitda: number;
  incomeItems: QoELineItem[];
  expenseItems: QoELineItem[];
  revenue: number | null;
  priorYearBadDebt: number | null;
  priorYearLegalFees: number | null;
};

// ---------------------------------------------------------------------------
// Non-recurring pattern definitions
// ---------------------------------------------------------------------------

const NON_RECURRING_INCOME_PATTERNS: Array<{
  pattern: RegExp;
  docRequired: boolean;
}> = [
  { pattern: /PPP/i, docRequired: false },
  { pattern: /paycheck protection/i, docRequired: false },
  { pattern: /EIDL/i, docRequired: false },
  { pattern: /SBA grant/i, docRequired: false },
  { pattern: /insurance proceeds/i, docRequired: true },
  { pattern: /business interruption/i, docRequired: true },
  { pattern: /gain on sale/i, docRequired: false },
  { pattern: /gain on disposal/i, docRequired: false },
  { pattern: /casualty gain/i, docRequired: false },
  { pattern: /litigation/i, docRequired: true },
  { pattern: /settlement proceeds/i, docRequired: true },
  { pattern: /tax refund/i, docRequired: false },
  { pattern: /forgiven/i, docRequired: false },
  { pattern: /debt forgiveness/i, docRequired: false },
  { pattern: /employee retention credit/i, docRequired: false },
  { pattern: /\bERC\b/, docRequired: false },
];

const NON_RECURRING_EXPENSE_PATTERNS: Array<{
  pattern: RegExp;
  docRequired: boolean;
}> = [
  { pattern: /disaster loss/i, docRequired: true },
  { pattern: /fire loss/i, docRequired: true },
  { pattern: /flood/i, docRequired: true },
  { pattern: /severance/i, docRequired: true },
  { pattern: /restructuring/i, docRequired: true },
  { pattern: /moving expense/i, docRequired: false },
  { pattern: /relocation/i, docRequired: false },
  { pattern: /start[- ]?up cost/i, docRequired: false },
  { pattern: /pre[- ]?opening/i, docRequired: false },
];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function computeQualityOfEarnings(
  input: QoEInput,
): QualityOfEarningsReport {
  const adjustments: QoEAdjustment[] = [];

  // --- Scan income items for non-recurring ---
  for (const item of input.incomeItems) {
    for (const nr of NON_RECURRING_INCOME_PATTERNS) {
      if (nr.pattern.test(item.label)) {
        adjustments.push({
          lineItem: item.label,
          amount: Math.abs(item.amount),
          direction: "deduct",
          classification: "non_recurring_income",
          source: item.source,
          documentationRequired: nr.docRequired,
          autoApproved: !nr.docRequired,
        });
        break;
      }
    }
  }

  // --- Scan expense items for non-recurring ---
  for (const item of input.expenseItems) {
    for (const nr of NON_RECURRING_EXPENSE_PATTERNS) {
      if (nr.pattern.test(item.label)) {
        adjustments.push({
          lineItem: item.label,
          amount: Math.abs(item.amount),
          direction: "add_back",
          classification: "non_recurring_expense",
          source: item.source,
          documentationRequired: nr.docRequired,
          autoApproved: !nr.docRequired,
        });
        break;
      }
    }
  }

  // --- Elevated threshold checks ---
  if (input.priorYearBadDebt !== null && input.priorYearBadDebt > 0) {
    for (const item of input.expenseItems) {
      if (/bad debt/i.test(item.label) && item.amount > input.priorYearBadDebt * 2) {
        adjustments.push({
          lineItem: item.label,
          amount: item.amount - input.priorYearBadDebt,
          direction: "add_back",
          classification: "non_recurring_expense",
          source: item.source,
          documentationRequired: true,
          autoApproved: false,
        });
      }
    }
  }

  if (input.priorYearLegalFees !== null && input.priorYearLegalFees > 0) {
    for (const item of input.expenseItems) {
      if (/legal/i.test(item.label) && item.amount > input.priorYearLegalFees * 1.5) {
        adjustments.push({
          lineItem: item.label,
          amount: item.amount - input.priorYearLegalFees,
          direction: "add_back",
          classification: "non_recurring_expense",
          source: item.source,
          documentationRequired: true,
          autoApproved: false,
        });
      }
    }
  }

  // --- Large "other" items > 5% of revenue ---
  if (input.revenue !== null && input.revenue > 0) {
    const threshold = input.revenue * 0.05;
    for (const item of [...input.incomeItems, ...input.expenseItems]) {
      if (/other\s+(income|expense)/i.test(item.label) && Math.abs(item.amount) > threshold) {
        const alreadyFlagged = adjustments.some((a) => a.lineItem === item.label);
        if (!alreadyFlagged) {
          adjustments.push({
            lineItem: item.label,
            amount: Math.abs(item.amount),
            direction: item.amount > 0 ? "deduct" : "add_back",
            classification: "non_recurring_income",
            source: item.source,
            documentationRequired: true,
            autoApproved: false,
          });
        }
      }
    }
  }

  // --- Compute totals ---
  let adjustmentTotal = 0;
  for (const adj of adjustments) {
    adjustmentTotal += adj.direction === "add_back" ? adj.amount : -adj.amount;
  }

  const adjustedEbitda = input.reportedEbitda + adjustmentTotal;

  // --- Determine confidence ---
  const confidence = determineConfidence(adjustments, input);

  return {
    reportedEbitda: input.reportedEbitda,
    adjustments,
    adjustedEbitda,
    adjustmentTotal,
    confidence,
  };
}

function determineConfidence(
  adjustments: QoEAdjustment[],
  input: QoEInput,
): QoEConfidence {
  if (adjustments.length === 0) return "high";

  const totalNonRecurring = adjustments.reduce(
    (sum, a) => sum + a.amount,
    0,
  );

  // Material non-recurring > 20% of reported EBITDA
  if (
    input.reportedEbitda > 0 &&
    totalNonRecurring / input.reportedEbitda > 0.2
  ) {
    return "low";
  }

  // Some uncertain items need review
  const hasUncertain = adjustments.some((a) => !a.autoApproved);
  if (hasUncertain) return "medium";

  return "high";
}
