/**
 * SPEC S4 E-1 — equity injection seasoning verifier. Pure function, no I/O.
 * Closes the third leg of S1's Sources & Uses three-way tie-out (S1 added
 * the rule; S2 fixed the math; this verifies seasoning).
 *
 * Plaid gives a point-in-time `current_balance`, not daily history — there
 * is no historical-balance table in this schema. Balance history is
 * reconstructed by walking transactions backward from `currentBalance`:
 * Plaid's sign convention is positive=debit (money out, decreases balance),
 * negative=credit (money in, increases balance), so
 * `balance_before = balance_after + amount` for each transaction as we
 * step back in time. This is exact as long as `transactions` is the
 * complete set for the account over the window — if the window predates
 * the earliest synced transaction, the reconstructed history is
 * necessarily incomplete and that's surfaced as a gap rather than assumed
 * clean.
 */

export type SourceTransaction = {
  posted_date: string;
  amount: number; // Plaid convention: positive=debit, negative=credit
  merchant_name?: string | null;
  description?: string | null;
};

export type BalancePoint = { date: string; balance: number };

export type LargeDeposit = { date: string; amount: number; source_label: string | null };

export type EquitySeasoningGap = { type: string; message: string };

export type VerifyEquitySeasoningResult = {
  seasoned: boolean;
  balance_history: BalancePoint[];
  large_deposits: LargeDeposit[];
  gaps: EquitySeasoningGap[];
};

const DEFAULT_REQUIRED_DAYS = 90;
const DAY_MS = 86_400_000;

function toUtcDay(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / DAY_MS) * DAY_MS;
}

export function verifyEquitySeasoning(args: {
  equityAmount: number;
  currentBalance: number;
  transactions: SourceTransaction[];
  requiredDays?: number;
  asOfDate?: string;
}): VerifyEquitySeasoningResult {
  const requiredDays = args.requiredDays ?? DEFAULT_REQUIRED_DAYS;
  const asOf = args.asOfDate ? toUtcDay(args.asOfDate) : toUtcDay(new Date().toISOString());
  const windowStart = asOf - requiredDays * DAY_MS;

  const gaps: EquitySeasoningGap[] = [];

  const sorted = [...args.transactions]
    .filter((t) => {
      const d = toUtcDay(t.posted_date);
      return d <= asOf;
    })
    .sort((a, b) => toUtcDay(b.posted_date) - toUtcDay(a.posted_date)); // most recent first

  // Reconstruct end-of-day balance for each day in the window by walking
  // backward from currentBalance.
  const balanceHistory: BalancePoint[] = [];
  let runningBalance = args.currentBalance;
  let cursor = asOf;
  let txIndex = 0;

  while (cursor >= windowStart) {
    // Apply (reverse) every transaction posted on `cursor`'s day before recording it.
    while (txIndex < sorted.length && toUtcDay(sorted[txIndex].posted_date) === cursor) {
      runningBalance += sorted[txIndex].amount;
      txIndex++;
    }
    balanceHistory.push({ date: new Date(cursor).toISOString().slice(0, 10), balance: runningBalance });
    cursor -= DAY_MS;
  }

  const earliestTxDay = sorted.length > 0 ? toUtcDay(sorted[sorted.length - 1].posted_date) : null;
  const historyInsufficient = earliestTxDay == null || earliestTxDay > windowStart;
  if (historyInsufficient) {
    gaps.push({
      type: "seasoning_window_incomplete",
      message: `Transaction history doesn't reach back the full ${requiredDays}-day seasoning window — provide additional bank statements to cover the gap.`,
    });
  }

  const belowThreshold = balanceHistory.filter((b) => b.balance < args.equityAmount);
  const seasoned = belowThreshold.length === 0 && !historyInsufficient;

  if (belowThreshold.length > 0) {
    const worst = belowThreshold.reduce((min, b) => (b.balance < min.balance ? b : min), belowThreshold[0]);
    gaps.push({
      type: "balance_below_equity_amount",
      message: `Balance dropped to $${worst.balance.toLocaleString()} on ${worst.date}, below the required equity amount of $${args.equityAmount.toLocaleString()}.`,
    });
  }

  const largeDepositThreshold = Math.max(5_000, args.equityAmount * 0.1);
  const largeDeposits: LargeDeposit[] = sorted
    .filter((t) => toUtcDay(t.posted_date) >= windowStart && t.amount < 0 && Math.abs(t.amount) >= largeDepositThreshold)
    .map((t) => ({ date: t.posted_date, amount: Math.abs(t.amount), source_label: t.merchant_name ?? t.description ?? null }));

  for (const dep of largeDeposits) {
    gaps.push({
      type: "large_deposit_needs_source_of_funds",
      message: `Needs source-of-funds documentation for a $${dep.amount.toLocaleString()} deposit on ${dep.date}.`,
    });
  }

  return { seasoned, balance_history: balanceHistory.reverse(), large_deposits: largeDeposits, gaps };
}
