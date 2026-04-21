// src/lib/sba/sbaConceptExplainer.ts
// Phase 3 — Plain-English explanations for every financial concept the
// borrower sees in the assumption interview and generated business plan.
// Pure: no DB, no LLM. Enriches "good range" with NAICS-specific benchmarks
// when the caller passes a NAICS code.

import { findBenchmarkByNaics } from "./sbaAssumptionBenchmarks";

export interface ConceptExplanation {
  term: string;
  plainEnglish: string;
  whyItMatters: string;
  goodRange: string;
  yourValue: string | null;
}

type ConceptBase = Omit<ConceptExplanation, "yourValue">;

const CONCEPTS: Record<string, ConceptBase> = {
  dscr: {
    term: "Debt Service Coverage Ratio (DSCR)",
    plainEnglish:
      "How many dollars of cash flow your business generates for every $1 of loan payments.",
    whyItMatters:
      "SBA lenders require at least $1.25 of cash flow for every $1 of debt payments. Below that, the loan is considered too risky.",
    goodRange: "1.25x is the SBA minimum. 1.50x+ is strong. 2.0x+ is excellent.",
  },
  cogs: {
    term: "Cost of Goods Sold (COGS)",
    plainEnglish:
      "The direct costs to produce what you sell — ingredients for a restaurant, materials for a contractor, inventory for a retailer.",
    whyItMatters:
      "COGS sets your gross margin — how much money is left after direct costs to cover rent, salaries, and loan payments.",
    goodRange: "Varies widely by industry — see your NAICS benchmark below.",
  },
  dso: {
    term: "Days Sales Outstanding (DSO)",
    plainEnglish:
      "How many days it takes, on average, for your customers to pay you after you deliver.",
    whyItMatters:
      "Longer collection times mean cash is tied up in receivables. If customers take 90 days but you must pay suppliers in 30, you have a cash gap.",
    goodRange: "Cash businesses (restaurants, retail) run 0–5 days. B2B services run 30–60 days.",
  },
  dpo: {
    term: "Days Payable Outstanding (DPO)",
    plainEnglish:
      "How many days you take to pay your suppliers after receiving their invoice.",
    whyItMatters:
      "Paying too fast uses cash you might need. Paying too slow can damage supplier relationships or trigger penalties.",
    goodRange: "Most industries land between 15 and 45 days.",
  },
  grossMargin: {
    term: "Gross Margin",
    plainEnglish:
      "The percentage of every dollar of revenue left after paying for direct costs.",
    whyItMatters:
      "Higher gross margin means more room to cover operating expenses and debt payments. Low margins make loan repayment much harder.",
    goodRange: "Varies by industry. Service businesses run 50–80%; restaurants 60–70%; construction 20–35%.",
  },
  equityInjection: {
    term: "Equity Injection",
    plainEnglish:
      "The cash you're putting into this deal from your own pocket — not borrowed money.",
    whyItMatters:
      "SBA requires you to have skin in the game. Minimum 10% for existing businesses, 20% for startups. It proves you're personally invested.",
    goodRange:
      "10% minimum for existing businesses. 20% minimum for startups. Higher equity strengthens your application.",
  },
  breakEven: {
    term: "Break-Even Revenue",
    plainEnglish:
      "The minimum revenue your business needs to cover all costs — before any profit.",
    whyItMatters:
      "If projected revenue is close to break-even, there's little margin for error. Lenders want to see significant cushion above break-even.",
    goodRange: "A margin of safety of 20%+ is strong. Below 10% is a red flag.",
  },
  sensitivity: {
    term: "Sensitivity Analysis",
    plainEnglish:
      "What happens to your ability to repay the loan if things don't go as planned — revenue dropping 15% or costs rising unexpectedly.",
    whyItMatters:
      "Lenders want proof that even in a bad year, the business can still make loan payments. This shows resilience.",
    goodRange: "Downside DSCR should stay above 1.0x. Below 1.0x means the business can't cover payments in a bad year.",
  },
  globalCashFlow: {
    term: "Global Cash Flow",
    plainEnglish:
      "Your total picture — business income plus personal income, minus business and personal debt (mortgage, car, etc.).",
    whyItMatters:
      "SBA requires lenders to look at the whole picture. Personal finances can strengthen or weaken the overall application.",
    goodRange: "Global DSCR above 1.25x is the SBA target.",
  },
  sourcesAndUses: {
    term: "Sources & Uses of Funds",
    plainEnglish:
      "A summary of where every dollar comes from (loan, your equity, seller financing) and exactly how it will be spent.",
    whyItMatters:
      "SBA needs to see that every dollar of the loan has a specific purpose and that sources equal uses — no unexplained gaps.",
    goodRange: "Sources must equal Uses (balanced). SBA won't approve unexplained shortfalls.",
  },
  ebitda: {
    term: "EBITDA",
    plainEnglish:
      "Earnings before interest, taxes, depreciation, and amortization — a clean view of operating cash flow.",
    whyItMatters:
      "EBITDA is the headline number lenders use to size debt capacity. The bigger and more stable, the more debt the business can carry.",
    goodRange: "Compare to industry medians (RMA / SBA SOP). Trending up beats absolute level.",
  },
  netIncome: {
    term: "Net Income",
    plainEnglish:
      "What's left after all expenses, interest, and taxes — your business's bottom line profit.",
    whyItMatters:
      "Net income drives retained earnings, equity build-up, and the borrower's ability to take owner draws or service personal obligations.",
    goodRange: "Positive and growing. Margins vary by industry; consult NAICS benchmarks.",
  },
  debtService: {
    term: "Annual Debt Service",
    plainEnglish:
      "Total principal + interest payments due in a year on all your loans (existing plus this new SBA loan).",
    whyItMatters:
      "Together with EBITDA, this defines DSCR. Stacking too much debt service shrinks DSCR even when revenue is stable.",
    goodRange: "Should stay below ~75% of EBITDA so DSCR holds at 1.25x+.",
  },
  interestRate: {
    term: "Interest Rate",
    plainEnglish:
      "The percentage cost of borrowing money each year, applied to your outstanding loan balance.",
    whyItMatters:
      "SBA 7(a) rates float with the WSJ Prime + a bank-set spread. A higher rate means more interest paid and a lower DSCR.",
    goodRange: "SBA 7(a) variable usually Prime + 2.25–2.75%. Fixed deals run higher.",
  },
  termMonths: {
    term: "Loan Term",
    plainEnglish:
      "How long you have to repay the loan, in months. Longer terms mean smaller monthly payments.",
    whyItMatters:
      "Term must match loan use: working capital up to 10 years; equipment up to 10 years; real estate up to 25 years.",
    goodRange: "120 months for working capital/equipment. 300 months for real estate.",
  },
  revenueGrowth: {
    term: "Revenue Growth Rate",
    plainEnglish:
      "How much your top-line revenue increases year over year, expressed as a percentage.",
    whyItMatters:
      "Aggressive growth needs evidence (signed contracts, new locations). Lenders discount unsupported growth.",
    goodRange: "Industry median ±2–3 points is defensible. Above 20%/yr usually requires specific drivers.",
  },
  fixedCosts: {
    term: "Fixed Costs",
    plainEnglish:
      "Expenses that don't change with revenue — rent, base salaries, insurance, software subscriptions.",
    whyItMatters:
      "Fixed costs determine your break-even point. They're the floor your revenue must clear before any profit.",
    goodRange: "Vary by business model. The lower your fixed cost base, the more resilient you are to revenue dips.",
  },
  workingCapital: {
    term: "Working Capital",
    plainEnglish:
      "Current assets (cash, receivables, inventory) minus current liabilities (payables, short-term debt) — the cash cushion that funds day-to-day operations.",
    whyItMatters:
      "Negative working capital means you can't cover near-term obligations. SBA lenders look for adequate working capital relative to revenue.",
    goodRange: "Generally aim for working capital of 10–20% of annual revenue.",
  },
  contributionMargin: {
    term: "Contribution Margin",
    plainEnglish:
      "Revenue minus variable costs — what each dollar of sales contributes to covering fixed costs and profit.",
    whyItMatters:
      "Contribution margin determines how quickly you climb above break-even and how exposed you are to price competition.",
    goodRange: "Mirrors gross margin in most simple models — see Gross Margin above.",
  },
  marginOfSafety: {
    term: "Margin of Safety",
    plainEnglish:
      "How far your projected revenue is above your break-even revenue, as a percentage.",
    whyItMatters:
      "A bigger margin of safety means more room to absorb a bad month or a soft quarter without missing loan payments.",
    goodRange: "20%+ is strong. 10–20% is acceptable. Below 10% is a red flag for SBA underwriting.",
  },
};

/**
 * Return a plain-English explanation for a financial concept, optionally
 * enriched with NAICS-specific benchmarks and the borrower's own value.
 */
export function getConceptExplanation(
  conceptKey: string,
  naicsCode: string | null,
  borrowerValue?: number,
): ConceptExplanation {
  const base = CONCEPTS[conceptKey];
  if (!base) {
    return {
      term: conceptKey,
      plainEnglish: "Financial metric used in the business plan.",
      whyItMatters: "Relevant to your SBA loan application.",
      goodRange: "Varies by industry.",
      yourValue: borrowerValue != null ? String(borrowerValue) : null,
    };
  }

  let goodRange = base.goodRange;
  const bench = findBenchmarkByNaics(naicsCode);
  if (bench) {
    if (conceptKey === "cogs") {
      goodRange = `Typical for ${bench.label}: ${(bench.cogsMedian * 100).toFixed(0)}%–${(bench.cogsHigh * 100).toFixed(0)}%`;
    } else if (conceptKey === "dso") {
      goodRange = `Typical for ${bench.label}: ${bench.dsoMedian}–${bench.dsoHigh} days`;
    } else if (conceptKey === "dpo") {
      goodRange = `Typical for ${bench.label}: ~${bench.dpoMedian} days`;
    } else if (conceptKey === "grossMargin") {
      const lowGm = (1 - bench.cogsHigh) * 100;
      const highGm = (1 - bench.cogsMedian) * 100;
      goodRange = `Typical for ${bench.label}: ${lowGm.toFixed(0)}%–${highGm.toFixed(0)}%`;
    } else if (conceptKey === "revenueGrowth") {
      goodRange = `Median for ${bench.label}: ${(bench.revenueGrowthMedian * 100).toFixed(0)}%/yr (above ${(bench.revenueGrowthMax * 100).toFixed(0)}% needs justification)`;
    } else if (conceptKey === "fixedCosts") {
      goodRange = `Annual escalation typical for ${bench.label}: ${(bench.fixedCostEscalationMedian * 100).toFixed(0)}–${(bench.fixedCostEscalationHigh * 100).toFixed(0)}%`;
    }
  }

  return {
    ...base,
    goodRange,
    yourValue: borrowerValue != null ? String(borrowerValue) : null,
  };
}
