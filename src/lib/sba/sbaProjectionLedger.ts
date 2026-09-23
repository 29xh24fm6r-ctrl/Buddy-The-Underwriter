import type { AnnualProjectionYear, SBAAssumptions, UseOfProceedsLine } from "./sbaReadinessTypes";
import type { BalanceSheetBaseYearInputs } from "./sbaBalanceSheetProjector";

// Planning assumptions, not a representation of a borrower's tax election.
export const PROJECTION_TAX_RATE = 0.25;
const TANGIBLE_LIFE_YEARS = 5;
// Franchise rights are a separate intangible, not equipment.
// Basis: https://www.irs.gov/instructions/i4562 (section 197 intangibles).
const FRANCHISE_LIFE_YEARS = 15;

type DebtMonth = { payment: number; interest: number; principal: number; balance: number;
  proposedPayment: number; existingPayment: number; sellerPayment: number };
type AssetYear = { capex: number; depreciation: number; amortization: number; fixedAssets: number; intangibleAssets: number };
export type ProjectionLedger = {
  closing: { inflows: number; outflows: number; inventory: number; fixedAssets: number;
    intangibleAssets: number; equityAdded: number; equityAlreadyOnHand: number; debtRetired: number };
  debt: DebtMonth[];
  assets: AssetYear[];
  opening?: BalanceSheetBaseYearInputs;
  blockers: string[];
  basis: string[];
};

export function projectionPayment(principal: number, annualRate: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0;
  const rate = annualRate / 12;
  return rate === 0 ? principal / months : principal * rate / (1 - (1 + rate) ** -months);
}

/** Infer the rate only when the supplied balance/payment/term describe a
 * fully amortizing retained note. Balloon or incomplete terms require review. */
function retainedRate(balance: number, payment: number, months: number): number | null {
  if (![balance, payment, months].every(Number.isFinite) || balance <= 0 || payment <= 0 || months <= 0 || !Number.isInteger(months)) return null;
  if (payment * months < balance - 0.01) return null;
  if (Math.abs(payment * months - balance) < 0.01) return 0;
  let low = 0;
  let high = 12;
  if (projectionPayment(balance, high, months) < payment) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (projectionPayment(balance, mid, months) > payment) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

/** Shared journal inputs for P&L, cash, and balance sheet. No balancing plugs. */
export function buildProjectionLedger(args: {
  assumptions: SBAAssumptions;
  baseYear?: AnnualProjectionYear;
  useOfProceeds?: UseOfProceedsLine[];
  opening?: BalanceSheetBaseYearInputs;
}): ProjectionLedger {
  const { assumptions: a, baseYear, opening, useOfProceeds = [] } = args;
  const li = a.loanImpact;
  const blockers: string[] = [];
  const basis = [
    "Projection periods begin at funding. Working-capital reserves remain cash; inventory and funded assets are recorded separately.",
    "Planning basis: 25% of positive pretax income for taxes, paid monthly; new tangible assets use five-year straight-line depreciation. These are model assumptions, not tax elections.",
    "Year-one planned capital spending includes funded tangible assets; only spending above that funded amount is additional. Later-year planned capital spending is additional.",
  ];
  const closing = { inflows: 0, outflows: 0, inventory: 0, fixedAssets: 0, intangibleAssets: 0,
    equityAdded: li.equityInjectionAmount ?? 0, equityAlreadyOnHand: 0, debtRetired: 0 };
  const sources = (li.otherSources ?? []).reduce((sum, source) => sum + source.amount, 0);
  if (sources !== 0) blockers.push("Classify other funding sources as debt or equity before preparing projections.");
  if (baseYear?.label === "Pre-opening" && opening) {
    // An opening equity balance is already contributed capital. Do not count
    // the cash-backed part of that same contribution as a second inflow.
    closing.equityAlreadyOnHand = Math.min(closing.equityAdded, Math.max(0, opening.cash),
      Math.max(0, opening.paidInCapital + opening.retainedEarnings));
    closing.equityAdded -= closing.equityAlreadyOnHand;
    if (closing.equityAlreadyOnHand > 0) basis.push(`$${closing.equityAlreadyOnHand.toLocaleString("en-US")} of startup equity is already on the opening balance sheet and is not added to cash a second time.`);
  }
  closing.inflows = li.loanAmount + (li.sellerFinancingAmount ?? 0) + closing.equityAdded + sources;
  for (const use of useOfProceeds) {
    if (!Number.isFinite(use.amount) || use.amount < 0) { blockers.push("Project costs must be finite, nonnegative amounts."); continue; }
    const category = use.category.toLowerCase().replace(/[ -]/g, "_");
    if (category === "working_capital") continue;
    closing.outflows += use.amount;
    if (category === "inventory") closing.inventory += use.amount;
    else if (["equipment", "purchase_or_construction"].includes(category)) closing.fixedAssets += use.amount;
    else if (["debt_refinance", "refinance", "debt_payoff"].includes(category)) closing.debtRetired += use.amount;
    else if (category === "franchise_fee" || (category === "other" && /\b(?:initial\s+)?franchise\s+fee\b/i.test(use.description) && !/\b(?:royalt|ongoing|monthly|annual)/i.test(use.description))) closing.intangibleAssets += use.amount;
    else if (use.amount > 0) blockers.push(`Review the asset or expense allocation for project cost: ${use.description || use.category}.`);
  }
  if (closing.intangibleAssets) basis.push("Initial franchise fees are modeled separately over 15 years, beginning in the first projection month; recurring royalties belong in operating costs.");

  const notes: { balance: number; rate: number; payment: number; months: number; kind: "proposedPayment" | "existingPayment" | "sellerPayment" }[] = [];
  const addLoan = (balance: number, rate: number, months: number, kind: "proposedPayment" | "sellerPayment") => {
    if (!balance) return;
    if (![balance, rate, months].every(Number.isFinite) || balance < 0 || rate < 0 || months <= 0 || !Number.isInteger(months)) {
      blockers.push("Complete the proposed loan and seller-note repayment terms."); return;
    }
    notes.push({ balance, rate, months, kind, payment: projectionPayment(balance, rate, months) });
  };
  addLoan(li.loanAmount, li.interestRate, li.termMonths, "proposedPayment");
  addLoan(li.sellerFinancingAmount ?? 0, li.sellerFinancingRate ?? 0, li.sellerFinancingTermMonths ?? 0, "sellerPayment");
  let retiredBalance = 0;
  let scheduledOpeningDebt = 0;
  for (const note of li.existingDebt ?? []) {
    scheduledOpeningDebt += note.currentBalance;
    if ((note.treatment ?? "retain") !== "retain") { retiredBalance += note.currentBalance; continue; }
    const rate = retainedRate(note.currentBalance, note.monthlyPayment, note.remainingTermMonths);
    if (rate === null) { blockers.push(`Complete an amortizing repayment schedule for retained debt: ${note.description}.`); continue; }
    notes.push({ balance: note.currentBalance, rate, months: note.remainingTermMonths, payment: note.monthlyPayment, kind: "existingPayment" });
  }
  if ((li.existingDebt ?? []).some(note => (note.treatment ?? "retain") === "retain")) basis.push("Retained-debt interest is derived from the reviewed balance, payment and remaining amortizing term.");
  if (Math.abs(retiredBalance - closing.debtRetired) > 0.01) blockers.push("Debt payoff uses must match the balances marked for payoff or refinance.");
  if (opening && Math.abs(opening.shortTermDebt + opening.longTermDebt - scheduledOpeningDebt) > 0.01) blockers.push("The existing debt schedule must reconcile to opening short-term and long-term debt.");
  // Include Year 4 so each projected balance can separate next-year principal.
  const debt: DebtMonth[] = Array.from({ length: 48 }, (_, index) => {
    const month: DebtMonth = { payment: 0, interest: 0, principal: 0, balance: 0, proposedPayment: 0, existingPayment: 0, sellerPayment: 0 };
    for (const note of notes) {
      if (index < note.months && note.balance > 0) {
        const interest = note.balance * note.rate / 12;
        const payment = index === note.months - 1 ? note.balance + interest : Math.min(note.payment, note.balance + interest);
        const principal = payment - interest;
        note.balance = Math.max(0, note.balance - principal);
        month.payment += payment; month.interest += interest; month.principal += principal; month[note.kind] += payment;
      }
      month.balance += note.balance;
    }
    return month;
  });

  let legacyAssets = opening?.fixedAssets ?? Number.POSITIVE_INFINITY;
  let newAssets = 0;
  let annualNewDepreciation = 0;
  let intangibleAssets = closing.intangibleAssets;
  const assets: AssetYear[] = [1, 2, 3].map(year => {
    const planned = (a.costAssumptions.plannedCapex ?? []).filter(item => item.year === year).reduce((sum, item) => sum + item.amount, 0);
    const capex = year === 1 ? Math.max(planned, closing.fixedAssets) : planned;
    newAssets += capex;
    annualNewDepreciation += capex / TANGIBLE_LIFE_YEARS;
    const legacyDepreciation = Math.min(legacyAssets, baseYear?.depreciation ?? 0);
    const newDepreciation = Math.min(newAssets, annualNewDepreciation);
    legacyAssets -= legacyDepreciation;
    newAssets -= newDepreciation;
    const amortization = Math.min(intangibleAssets, closing.intangibleAssets / FRANCHISE_LIFE_YEARS);
    intangibleAssets -= amortization;
    return { capex, depreciation: legacyDepreciation + newDepreciation, amortization,
      fixedAssets: (Number.isFinite(legacyAssets) ? legacyAssets : 0) + newAssets, intangibleAssets };
  });
  return { closing, debt, assets, opening, blockers, basis };
}

export function debtYear(ledger: ProjectionLedger, year: number) {
  const months = ledger.debt.slice((year - 1) * 12, year * 12);
  const sum = (key: keyof DebtMonth) => months.reduce((total, row) => total + row[key], 0);
  return { payment: sum("payment"), interest: sum("interest"), principal: sum("principal"),
    existingPayment: sum("existingPayment"), proposedPayment: sum("proposedPayment"), sellerPayment: sum("sellerPayment"),
    balance: months.at(-1)?.balance ?? 0,
    currentPortion: ledger.debt.slice(year * 12, (year + 1) * 12).reduce((total, row) => total + row.principal, 0) };
}
