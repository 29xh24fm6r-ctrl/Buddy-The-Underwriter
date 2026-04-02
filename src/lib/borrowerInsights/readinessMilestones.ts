/* ------------------------------------------------------------------ */
/*  Readiness Milestones — pure computation, no DB, no IO             */
/* ------------------------------------------------------------------ */

import type { MetricSnapshot } from "./rootCauseTree";

export type Milestone = {
  id: string;
  label: string;
  description: string;
  targetMetric: string;
  currentValue: number;
  targetValue: number;
  /** 0–100 */
  progress: number;
  actions: string[];
  estimatedTimeframe: string;
};

/* ------------------------------------------------------------------ */
/*  Known metric metadata for labeling / actions                       */
/* ------------------------------------------------------------------ */

type MetricMeta = {
  label: string;
  description: string;
  actions: string[];
  timeframe: string;
};

const METRIC_META: Record<string, MetricMeta> = {
  dscr: {
    label: "Strengthen Debt Service Coverage",
    description:
      "Improve the ratio of net operating income to total debt service so the business comfortably covers loan payments.",
    actions: [
      "Reduce owner draws to increase cash available for debt service",
      "Cut discretionary operating expenses",
      "Increase revenue through pricing or occupancy improvements",
      "Defer non-essential capital expenditure",
    ],
    timeframe: "1-3 months",
  },
  ltv: {
    label: "Improve Loan-to-Value Position",
    description:
      "Reduce the loan amount relative to property or collateral value.",
    actions: [
      "Make additional principal payments to reduce outstanding balance",
      "Obtain updated appraisal if market values have improved",
      "Add supplemental collateral to improve position",
    ],
    timeframe: "3-6 months",
  },
  current_ratio: {
    label: "Build Short-Term Financial Cushion",
    description:
      "Increase current assets relative to current liabilities to demonstrate ability to meet short-term obligations.",
    actions: [
      "Accelerate accounts receivable collection",
      "Build cash reserves by reducing discretionary spending",
      "Renegotiate short-term payables to longer terms",
      "Reduce inventory levels for slow-moving items",
    ],
    timeframe: "1-3 months",
  },
  leverage: {
    label: "Reduce Overall Borrowing Level",
    description:
      "Lower total debt relative to equity to reduce risk profile.",
    actions: [
      "Pay down existing debt balances",
      "Retain earnings instead of distributing to owners",
      "Consider equity injection from owners or investors",
    ],
    timeframe: "3-12 months",
  },
  gross_margin: {
    label: "Improve Gross Profit Margin",
    description:
      "Increase the spread between revenue and direct costs.",
    actions: [
      "Renegotiate supplier pricing or terms",
      "Review product/service pricing for below-market items",
      "Reduce waste and improve production efficiency",
    ],
    timeframe: "1-3 months",
  },
  net_margin: {
    label: "Improve Net Profit Margin",
    description:
      "Increase bottom-line profitability by managing both revenue and expenses.",
    actions: [
      "Audit all operating expenses for reduction opportunities",
      "Evaluate staffing levels against revenue",
      "Review and renegotiate recurring contracts",
    ],
    timeframe: "2-6 months",
  },
  occupancy: {
    label: "Increase Occupancy Rate",
    description: "Fill vacant units to maximize rental income.",
    actions: [
      "Review market rents and adjust pricing if above market",
      "Invest in targeted marketing to attract tenants",
      "Offer move-in incentives for quick lease-up",
      "Improve unit condition to attract quality tenants",
    ],
    timeframe: "2-6 months",
  },
  debt_yield: {
    label: "Improve Debt Yield",
    description:
      "Increase NOI relative to loan amount to meet lender requirements.",
    actions: [
      "Increase NOI through revenue growth or expense reduction",
      "Reduce requested loan amount if possible",
      "Improve property operations to justify higher income",
    ],
    timeframe: "3-6 months",
  },
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function generateMilestones(
  metrics: MetricSnapshot,
  _loanType: string,
  targetMetrics: Record<string, number>,
): Milestone[] {
  const milestones: Milestone[] = [];

  // Build milestone for each target metric
  for (const [metricKey, targetValue] of Object.entries(targetMetrics)) {
    const current = metrics[metricKey];
    if (!current) continue;

    const currentValue = current.value;
    const gap = Math.abs(targetValue - currentValue);
    const totalRange = Math.abs(targetValue - (current.priorValue ?? 0));

    // Progress: how far along from 0 (or prior) to target
    let progress: number;
    if (currentValue >= targetValue && targetValue > 0) {
      progress = 100;
    } else if (totalRange === 0) {
      progress = currentValue >= targetValue ? 100 : 0;
    } else {
      progress = Math.max(
        0,
        Math.min(100, ((currentValue / targetValue) * 100)),
      );
    }

    const meta = METRIC_META[metricKey];
    const label = meta?.label ?? `Improve ${metricKey}`;
    const description =
      meta?.description ?? `Bring ${metricKey} from ${currentValue} to ${targetValue}.`;
    const actions = meta?.actions ?? [
      `Work toward improving ${metricKey} to meet lender requirements`,
    ];
    const estimatedTimeframe = meta?.timeframe ?? "3-6 months";

    milestones.push({
      id: `milestone_${metricKey}`,
      label,
      description,
      targetMetric: metricKey,
      currentValue,
      targetValue,
      progress: Math.round(progress),
      actions,
      estimatedTimeframe,
    });
  }

  // Sort by gap severity: furthest from target first
  milestones.sort((a, b) => {
    const gapA =
      a.targetValue === 0
        ? 0
        : Math.abs(a.targetValue - a.currentValue) / Math.abs(a.targetValue);
    const gapB =
      b.targetValue === 0
        ? 0
        : Math.abs(b.targetValue - b.currentValue) / Math.abs(b.targetValue);
    return gapB - gapA;
  });

  return milestones;
}
