import type { ClassifiedTransaction, DerivedRecurrence, PlaidTransactionLike } from "@/lib/integrations/plaid/types";

/**
 * Transaction classifier — pure, deterministic, no I/O. Labels MCAs,
 * payroll, rent, recurring payments, transfers, and SBA loan payments so
 * downstream (S4: debt-schedule auto-build, equity-injection seasoning)
 * can consume `derived_category` without re-deriving it.
 *
 * Principle #15 (SPEC S2): Plaid soft data only — this never touches
 * credit-bureau data.
 */

const PAYROLL_PATTERN = /payroll|gusto|adp|paychex/i;
const MCA_PATTERN = /\bmca\b|merchant\s*cash|cleartocash|kapitus|forwardline|ondeck|libertas/i;
const TRANSFER_PATTERN = /transfer|zelle|venmo|cash\s*app/i;
const SBA_LOAN_PATTERN = /sba.*loan|sba-7a|small business administration/i;
const RENT_PATTERN = /\brent\b|lease/i;

function descriptionOf(tx: PlaidTransactionLike): string {
  return `${tx.name ?? ""} ${tx.merchant_name ?? ""}`.trim();
}

function normalizeMerchant(tx: PlaidTransactionLike): string {
  return (tx.merchant_name ?? tx.name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Groups `target` with same-merchant transactions from `siblings` (a
 * caller-supplied window of the account's history — this module never
 * fetches it itself) and detects a consistent recurring cadence.
 * Requires 3+ occurrences within a 100-day span at a consistent interval:
 * 28–32 days = monthly, 13–15 = biweekly, 6–8 = weekly. Otherwise null
 * (irregular / not enough history to tell).
 */
function detectRecurrence(target: PlaidTransactionLike, siblings: PlaidTransactionLike[]): DerivedRecurrence | null {
  const key = normalizeMerchant(target);
  if (!key) return null;

  const group = [target, ...siblings].filter((t) => normalizeMerchant(t) === key);
  if (group.length < 3) return null;

  const dates = group.map((t) => new Date(t.date).getTime()).sort((a, b) => a - b);
  const spanDays = (dates[dates.length - 1] - dates[0]) / 86_400_000;
  if (spanDays > 100) return null;

  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) intervals.push((dates[i] - dates[i - 1]) / 86_400_000);
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const consistent = intervals.every((iv) => Math.abs(iv - avgInterval) <= 4);
  if (!consistent) return null;

  if (avgInterval >= 28 && avgInterval <= 32) return "monthly";
  if (avgInterval >= 13 && avgInterval <= 15) return "biweekly";
  if (avgInterval >= 6 && avgInterval <= 8) return "weekly";
  return null;
}

/**
 * Classify a single transaction. `siblings` should be other transactions
 * from the same account (any window ≤100 days is sufficient) — used only
 * for recurrence detection, never to change which pattern-based category
 * applies. Pattern matches (payroll/MCA/transfer/SBA loan payment) fire
 * regardless of recurrence; `rent` and the catch-all `recurring_payment`
 * require a detected monthly cadence.
 */
export function classifyTransaction(
  tx: PlaidTransactionLike,
  siblings: PlaidTransactionLike[] = [],
): ClassifiedTransaction {
  const description = descriptionOf(tx);

  if (PAYROLL_PATTERN.test(description)) {
    return { derived_category: "payroll", derived_recurrence: detectRecurrence(tx, siblings) };
  }
  if (MCA_PATTERN.test(description)) {
    return { derived_category: "mca", derived_recurrence: detectRecurrence(tx, siblings) };
  }
  if (TRANSFER_PATTERN.test(description)) {
    return { derived_category: "transfer", derived_recurrence: "irregular" };
  }
  if (SBA_LOAN_PATTERN.test(description)) {
    return { derived_category: "sba_loan_payment", derived_recurrence: "monthly" };
  }

  const recurrence = detectRecurrence(tx, siblings);
  if (RENT_PATTERN.test(description) && recurrence === "monthly") {
    return { derived_category: "rent", derived_recurrence: "monthly" };
  }
  if (recurrence === "monthly" && tx.amount > 0) {
    return { derived_category: "recurring_payment", derived_recurrence: "monthly" };
  }

  return { derived_category: null, derived_recurrence: null };
}
