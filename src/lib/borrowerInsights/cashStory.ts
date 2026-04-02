/* ------------------------------------------------------------------ */
/*  Cash Story — pure computation, no DB, no IO                       */
/* ------------------------------------------------------------------ */

export type CashStoryInput = {
  revenue: number;
  revenueGrowth?: number;
  grossMargin?: number;
  opex?: number;
  opexGrowth?: number;
  debtService?: number;
  ownerDraws?: number;
  capex?: number;
  arDays?: number;
  apDays?: number;
};

export type CashStory = {
  headline: string;
  paragraphs: string[];
  keyInsight: string;
  primaryPressure: string;
  firstAction: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

type PressureSource = {
  label: string;
  description: string;
  action: string;
  severity: number; // higher = worse
};

function identifyPressures(input: CashStoryInput): PressureSource[] {
  const pressures: PressureSource[] = [];

  if (
    input.opexGrowth !== undefined &&
    input.revenueGrowth !== undefined &&
    input.opexGrowth > input.revenueGrowth
  ) {
    const gap = input.opexGrowth - input.revenueGrowth;
    pressures.push({
      label: "Expense growth outpacing revenue",
      description: `Operating expenses are growing ${pct(gap)} faster than revenue.`,
      action:
        "Review each expense category for reduction opportunities, starting with the largest line items.",
      severity: gap * 100,
    });
  }

  if (input.debtService !== undefined && input.revenue > 0) {
    const dsRatio = input.debtService / input.revenue;
    if (dsRatio > 0.25) {
      pressures.push({
        label: "Heavy debt service burden",
        description: `Debt service consumes ${pct(dsRatio)} of revenue.`,
        action:
          "Explore refinancing options to reduce monthly payments or extend terms.",
        severity: dsRatio * 100,
      });
    }
  }

  if (input.ownerDraws !== undefined && input.revenue > 0) {
    const drawRatio = input.ownerDraws / input.revenue;
    if (drawRatio > 0.15) {
      pressures.push({
        label: "High owner draws",
        description: `Owner draws represent ${pct(drawRatio)} of revenue.`,
        action:
          "Consider temporarily reducing owner distributions to preserve cash for operations.",
        severity: drawRatio * 80,
      });
    }
  }

  if (input.arDays !== undefined && input.arDays > 45) {
    pressures.push({
      label: "Slow receivables collection",
      description: `It takes an average of ${input.arDays} days to collect receivables.`,
      action:
        "Tighten payment terms and implement proactive collection follow-ups.",
      severity: (input.arDays - 30) * 0.5,
    });
  }

  if (input.capex !== undefined && input.revenue > 0) {
    const capexRatio = input.capex / input.revenue;
    if (capexRatio > 0.1) {
      pressures.push({
        label: "Significant capital expenditure",
        description: `Capital spending represents ${pct(capexRatio)} of revenue.`,
        action:
          "Evaluate whether any capital projects can be deferred until cash flow improves.",
        severity: capexRatio * 60,
      });
    }
  }

  if (input.grossMargin !== undefined && input.grossMargin < 0.3) {
    pressures.push({
      label: "Thin gross margins",
      description: `Gross margin is ${pct(input.grossMargin)}, leaving little room for operating costs.`,
      action:
        "Review pricing strategy and direct cost structure for improvement opportunities.",
      severity: (0.5 - input.grossMargin) * 80,
    });
  }

  pressures.sort((a, b) => b.severity - a.severity);
  return pressures;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function buildCashStory(input: CashStoryInput): CashStory {
  const pressures = identifyPressures(input);
  const paragraphs: string[] = [];

  // Opening paragraph — revenue context
  if (input.revenueGrowth !== undefined) {
    if (input.revenueGrowth > 0) {
      paragraphs.push(
        `Your revenue of ${fmt(input.revenue)} grew ${pct(input.revenueGrowth)} over the prior period. ` +
          (pressures.length > 0
            ? "Despite that growth, cash may feel tighter because of the pressures described below."
            : "Cash flow is keeping pace with that growth."),
      );
    } else if (input.revenueGrowth < 0) {
      paragraphs.push(
        `Revenue declined ${pct(Math.abs(input.revenueGrowth))} to ${fmt(input.revenue)}. ` +
          "When the top line shrinks, every other cost line becomes a larger share of revenue, squeezing cash.",
      );
    } else {
      paragraphs.push(
        `Revenue is flat at ${fmt(input.revenue)}. Without growth, any increase in expenses directly compresses cash flow.`,
      );
    }
  } else {
    paragraphs.push(
      `Based on revenue of ${fmt(input.revenue)}, here is what is driving your cash position.`,
    );
  }

  // Pressure paragraphs
  for (const p of pressures.slice(0, 3)) {
    paragraphs.push(`${p.description} ${p.action}`);
  }

  // Headline
  const headline =
    pressures.length === 0
      ? "Cash flow is healthy relative to your revenue."
      : pressures.length === 1
        ? `Cash is being squeezed by ${pressures[0].label.toLowerCase()}.`
        : `Cash is under pressure from ${pressures.length} factors, led by ${pressures[0].label.toLowerCase()}.`;

  const primaryPressure =
    pressures.length > 0 ? pressures[0].label : "No significant pressure identified";

  const firstAction =
    pressures.length > 0
      ? pressures[0].action
      : "Continue monitoring key metrics to maintain current performance.";

  const keyInsight =
    pressures.length === 0
      ? "Your cash generation is well-aligned with your revenue and expense structure."
      : pressures.length === 1
        ? `The primary driver is ${pressures[0].label.toLowerCase()}. Addressing this alone could meaningfully improve your cash position.`
        : `The biggest factor is ${pressures[0].label.toLowerCase()}, but ${pressures[1].label.toLowerCase()} is also contributing. Tackling the top issue first will have the most impact.`;

  return {
    headline,
    paragraphs,
    keyInsight,
    primaryPressure,
    firstAction,
  };
}
