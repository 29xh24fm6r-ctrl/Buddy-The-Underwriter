import { buildSourcesAndUses } from "@/lib/sba/sbaSourcesAndUses";
import { buildUseOfProceeds } from "@/lib/sba/sbaForwardModelBuilder";

export type BorrowerBudgetReview = {
  totalSources: number; totalUses: number; difference: number; balanced: boolean;
  message: string;
};

/** Read saved inputs through the same calculation used by package generation. */
export function borrowerBudgetReview(loanImpact: unknown, proceeds: unknown): BorrowerBudgetReview | null {
  if (!loanImpact || typeof loanImpact !== "object" || !Array.isArray(proceeds) || !proceeds.length) return null;
  const loan = loanImpact as Record<string, any>;
  const validAmount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!validAmount(loan.loanAmount) || !validAmount(loan.equityInjectionAmount) ||
      !validAmount(loan.sellerFinancingAmount ?? 0) ||
      !proceeds.every(row => row && typeof row.category === "string" && validAmount(row.amount)) ||
      !Array.isArray(loan.otherSources ?? []) ||
      !(loan.otherSources ?? []).every((row: any) => row && validAmount(row.amount))) return null;
  const budget = buildSourcesAndUses({
    loanAmount: loan.loanAmount, equityInjectionAmount: loan.equityInjectionAmount,
    equityInjectionSource: loan.equityInjectionSource ?? "cash_savings",
    sellerFinancingAmount: loan.sellerFinancingAmount ?? 0, otherSources: loan.otherSources ?? [],
    useOfProceeds: buildUseOfProceeds(proceeds, loan.loanAmount),
    sellerNoteEquityPortion: 0, sellerNoteFullStandby: false,
  });
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  return { totalSources: budget.totalSources, totalUses: budget.totalUses, difference: budget.imbalance,
    balanced: budget.balanced,
    message: budget.balanced ? "Your funding matches your project costs." :
      `Your funding totals ${money(budget.totalSources)} and your project costs total ${money(budget.totalUses)}. ` +
      (budget.imbalance > 0 ? `${money(budget.imbalance)} of funding is not assigned to a project cost. ` : `Your costs exceed funding by ${money(Math.abs(budget.imbalance))}. `) +
      "Review all project costs, including costs paid with your contribution, or correct your funding assumptions. Only enter actual planned costs.",
  };
}
