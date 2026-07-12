/**
 * SPEC S4 F-1 — auto-builds a business debt schedule from Plaid-derived
 * transaction categories. Pure function, no I/O. Banker reviews and
 * confirms; this is a suggestion, not authority (risk register #8) — the
 * existing manual debt-entry path is untouched.
 */

export type BorrowerBankTransactionLike = {
  posted_date: string;
  amount: number; // Plaid convention: positive=debit
  merchant_name?: string | null;
  description?: string | null;
  derived_category?: string | null; // 'recurring_payment' | 'mca' | 'sba_loan_payment' | ...
};

export type DebtScheduleAccountType = "mortgage" | "credit_card" | "auto_loan" | "sba_loan" | "mca" | "other";

export type DebtScheduleEntry = {
  creditor: string;
  monthly_payment: number;
  estimated_balance: number;
  account_type_inferred: DebtScheduleAccountType;
  confidence: number;
};

const DEBT_CATEGORIES = new Set(["recurring_payment", "mca", "sba_loan_payment"]);
const MORTGAGE_PATTERN = /mortgage|mtg/i;

function normalizeMerchant(tx: BorrowerBankTransactionLike): string {
  return (tx.merchant_name ?? tx.description ?? "").trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function monthsOfHistory(dates: string[]): number {
  if (dates.length === 0) return 0;
  const times = dates.map((d) => new Date(d).getTime());
  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  return spanDays / 30;
}

function inferAccountType(creditor: string, category: string | null | undefined): DebtScheduleAccountType {
  if (MORTGAGE_PATTERN.test(creditor)) return "mortgage";
  if (category === "mca") return "mca";
  if (category === "sba_loan_payment") return "sba_loan";
  if (/visa|mastercard|amex|discover|credit card|card services/i.test(creditor)) return "credit_card";
  if (/auto|vehicle|toyota|honda|ford credit/i.test(creditor)) return "auto_loan";
  return "other";
}

function estimateBalance(monthlyPayment: number, accountType: DebtScheduleAccountType): number {
  // Heuristic per spec F-1: monthly_payment × 60 for unsecured,
  // × 240 for mortgage-shaped.
  const multiplier = accountType === "mortgage" ? 240 : 60;
  return monthlyPayment * multiplier;
}

export function buildDebtSchedule(transactions: BorrowerBankTransactionLike[]): DebtScheduleEntry[] {
  const debtTx = transactions.filter((t) => t.derived_category && DEBT_CATEGORIES.has(t.derived_category) && t.amount > 0);

  const groups = new Map<string, BorrowerBankTransactionLike[]>();
  for (const tx of debtTx) {
    const key = normalizeMerchant(tx).toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const entries: DebtScheduleEntry[] = [];
  for (const [, group] of groups) {
    const creditor = normalizeMerchant(group[0]);
    const category = group[0].derived_category ?? null;
    const accountType = inferAccountType(creditor, category);

    // Median of last 6 months of payments for this creditor.
    const sortedByDate = [...group].sort((a, b) => new Date(b.posted_date).getTime() - new Date(a.posted_date).getTime());
    const last6mo = sortedByDate.slice(0, 6);
    const monthlyPayment = median(last6mo.map((t) => t.amount));
    const estimatedBalance = estimateBalance(monthlyPayment, accountType);

    const monthsSeen = monthsOfHistory(group.map((t) => t.posted_date));
    const confidence = monthsSeen >= 6 ? 0.7 : monthsSeen >= 3 ? 0.6 : monthsSeen >= 1.5 ? 0.5 : 0.3;

    entries.push({ creditor, monthly_payment: monthlyPayment, estimated_balance: estimatedBalance, account_type_inferred: accountType, confidence });
  }

  return entries;
}
