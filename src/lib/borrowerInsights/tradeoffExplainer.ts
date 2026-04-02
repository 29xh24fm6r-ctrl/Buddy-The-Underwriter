/* ------------------------------------------------------------------ */
/*  Tradeoff Explainer — pure computation, no DB, no IO               */
/* ------------------------------------------------------------------ */

import type { RankedLever } from "./leverRanking";

export type Tradeoff = {
  leverA: string;
  leverB: string;
  conflict: string;
  recommendation: string;
  borrowerExplanation: string;
};

/* ------------------------------------------------------------------ */
/*  Known tradeoff pairs                                               */
/* ------------------------------------------------------------------ */

type TradeoffRule = {
  leverA: string;
  leverB: string;
  conflict: string;
  recommendation: string;
  borrowerExplanation: string;
};

const TRADEOFF_RULES: TradeoffRule[] = [
  {
    leverA: "reduce_discretionary_expenses",
    leverB: "increase_pricing",
    conflict:
      "Cutting marketing/sales expenses may reduce your ability to implement and communicate price increases.",
    recommendation:
      "Prioritize targeted cost cuts that do not affect customer-facing capabilities while testing price increases on select products.",
    borrowerExplanation:
      "Cutting costs is quick, but if you cut marketing spend at the same time you raise prices, customers may push back harder. Keep some sales budget to support the price change.",
  },
  {
    leverA: "reduce_discretionary_expenses",
    leverB: "improve_occupancy",
    conflict:
      "Cutting marketing and leasing spend reduces the budget available to attract new tenants.",
    recommendation:
      "Maintain leasing-related spend while cutting non-leasing discretionary items.",
    borrowerExplanation:
      "You need to spend a little to fill vacancies. Cut other expenses first and protect your leasing budget until occupancy improves.",
  },
  {
    leverA: "defer_capital_expenditure",
    leverB: "improve_occupancy",
    conflict:
      "Deferring property improvements may make units less competitive, reducing occupancy.",
    recommendation:
      "Defer non-tenant-facing capex while investing in improvements that directly support leasing.",
    borrowerExplanation:
      "Putting off repairs saves cash now, but shabby units are harder to rent. Focus spending on the improvements tenants actually see.",
  },
  {
    leverA: "defer_capital_expenditure",
    leverB: "increase_pricing",
    conflict:
      "Customers may resist price increases if product/property quality is visibly declining from deferred maintenance.",
    recommendation:
      "If raising prices, maintain minimum capex to preserve perceived quality.",
    borrowerExplanation:
      "It is hard to charge more when things look run-down. If you raise prices, keep up the basics so customers feel the value.",
  },
  {
    leverA: "reduce_owner_draws",
    leverB: "reduce_discretionary_expenses",
    conflict:
      "Both levers reduce cash outflow but through different channels. Over-tightening on both can create operational and personal financial strain.",
    recommendation:
      "Start with owner draws reduction — it has the most direct impact on DSCR and signals commitment to lenders.",
    borrowerExplanation:
      "Cutting your own pay and cutting business expenses at the same time can be a lot. Start by reducing your draws — lenders notice that — and then see if further business cuts are needed.",
  },
  {
    leverA: "accelerate_ar_collection",
    leverB: "increase_pricing",
    conflict:
      "Tightening payment terms while raising prices may push price-sensitive customers to competitors.",
    recommendation:
      "Stagger the changes — implement collection improvements first, then phase in price increases after cash flow stabilizes.",
    borrowerExplanation:
      "Asking customers to pay faster AND pay more at the same time is a tough conversation. Fix collections first, then look at prices once cash is flowing better.",
  },
  {
    leverA: "reduce_owner_draws",
    leverB: "refinance_existing_debt",
    conflict:
      "Lenders reviewing a refinance want to see sustainable owner compensation, not artificially depressed draws.",
    recommendation:
      "Reduce draws to a reasonable level but maintain a documented, sustainable owner salary for refinance underwriting.",
    borrowerExplanation:
      "If you cut your pay to zero to look better on paper, a new lender will wonder if the business can really support a loan. Take a reasonable salary and let the numbers speak for themselves.",
  },
  {
    leverA: "reduce_inventory_levels",
    leverB: "increase_pricing",
    conflict:
      "Reducing inventory may cause stockouts that undermine pricing power.",
    recommendation:
      "Optimize slow-moving inventory only. Maintain stock levels for products where you are increasing prices.",
    borrowerExplanation:
      "Running out of stock makes customers go elsewhere — especially if prices just went up. Only trim the inventory that is not selling well.",
  },
];

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function explainTradeoffs(levers: RankedLever[]): Tradeoff[] {
  const leverSet = new Set(levers.map((l) => l.lever));
  const tradeoffs: Tradeoff[] = [];

  for (const rule of TRADEOFF_RULES) {
    if (leverSet.has(rule.leverA) && leverSet.has(rule.leverB)) {
      tradeoffs.push({
        leverA: rule.leverA,
        leverB: rule.leverB,
        conflict: rule.conflict,
        recommendation: rule.recommendation,
        borrowerExplanation: rule.borrowerExplanation,
      });
    }
  }

  return tradeoffs;
}
