/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 8: AR Revolver / ABL Borrowing Base Engine.
 *
 * Turns a detailed AR aging into an examiner-defensible eligible-collateral
 * schedule and borrowing-base availability. Pure + deterministic — it explains
 * every excluded dollar by reason; it never fabricates and never writes.
 *
 * Ineligibility rules (each dollar attributed to exactly one first-hit reason):
 *   disputed → retainage → foreign → government → affiliate → over-90 →
 *   cross-aged → contra → concentration-cap.
 * Then: dilution reserve, advance rate, and collateral shortfall vs outstanding.
 */

export type ARAccount = {
  customerId: string;
  customerName?: string;
  /** Gross outstanding for this account/invoice. */
  amount: number;
  /** Age of the receivable in days. */
  daysPastInvoice: number;
  government?: boolean;
  foreign?: boolean;
  affiliate?: boolean;
  disputed?: boolean;
  retainage?: boolean;
  /** Contra (offsetting AP owed to this customer) reducing eligible for the account. */
  contra?: number;
};

export type BorrowingBasePolicy = {
  /** Advance rate applied to net eligible AR (e.g. 0.85). */
  advanceRate: number;
  /** Age (days) beyond which an invoice is ineligible (e.g. 90). */
  over90ExcludedDays: number;
  /** If ≥ this fraction of a customer's balance is over-90, ALL of it is cross-aged out. */
  crossAgePct: number;
  /** Per-customer eligible cap as a fraction of total eligible (e.g. 0.20). */
  concentrationCapPct: number;
  /** Dilution reserve as a fraction of post-concentration eligible (e.g. 0.05). */
  dilutionReservePct: number;
  foreignEligible: boolean;
  governmentEligible: boolean;
  affiliateEligible: boolean;
  retainageEligible: boolean;
};

export const DEFAULT_BB_POLICY: BorrowingBasePolicy = {
  advanceRate: 0.85,
  over90ExcludedDays: 90,
  crossAgePct: 0.5,
  concentrationCapPct: 0.2,
  dilutionReservePct: 0.05,
  foreignEligible: false,
  governmentEligible: false,
  affiliateEligible: false,
  retainageEligible: false,
};

export type IneligibleReason =
  | "disputed"
  | "retainage"
  | "foreign"
  | "government"
  | "affiliate"
  | "over_90"
  | "cross_aged"
  | "contra"
  | "concentration_cap";

export type EvaluatedARAccount = {
  customerId: string;
  amount: number;
  eligible: number;
  ineligible: number;
  reasons: IneligibleReason[];
};

export type AgingBucket = "current" | "1_30" | "31_60" | "61_90" | "over_90";

export type BorrowingBaseResult = {
  grossAr: number;
  agingBuckets: Record<AgingBucket, number>;
  ineligibleByReason: Record<IneligibleReason, number>;
  eligibleBeforeReserves: number;
  dilutionReserve: number;
  netEligible: number;
  advanceRate: number;
  borrowingBaseAvailability: number;
  /** outstanding − availability when a loan balance is supplied and positive; else null. */
  collateralShortfall: number | null;
  accounts: EvaluatedARAccount[];
};

function emptyReasonMap(): Record<IneligibleReason, number> {
  return {
    disputed: 0,
    retainage: 0,
    foreign: 0,
    government: 0,
    affiliate: 0,
    over_90: 0,
    cross_aged: 0,
    contra: 0,
    concentration_cap: 0,
  };
}

function bucketOf(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "over_90";
}

export function computeBorrowingBase(
  accounts: ARAccount[],
  policy: BorrowingBasePolicy = DEFAULT_BB_POLICY,
  outstandingLoan?: number,
): BorrowingBaseResult {
  const ineligibleByReason = emptyReasonMap();
  const agingBuckets: Record<AgingBucket, number> = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
  let grossAr = 0;

  // Pre-compute per-customer cross-age: fraction of a customer's balance over-90.
  const custTotal = new Map<string, number>();
  const custOver90 = new Map<string, number>();
  for (const a of accounts) {
    custTotal.set(a.customerId, (custTotal.get(a.customerId) ?? 0) + a.amount);
    if (a.daysPastInvoice > policy.over90ExcludedDays) {
      custOver90.set(a.customerId, (custOver90.get(a.customerId) ?? 0) + a.amount);
    }
  }
  const crossAgedCustomers = new Set<string>();
  for (const [cust, total] of custTotal) {
    const over = custOver90.get(cust) ?? 0;
    if (total > 0 && over / total >= policy.crossAgePct) crossAgedCustomers.add(cust);
  }

  const evaluated: EvaluatedARAccount[] = [];

  // Pass 1: base ineligibility (everything except concentration).
  for (const a of accounts) {
    grossAr += a.amount;
    agingBuckets[bucketOf(a.daysPastInvoice)] += a.amount;

    const reasons: IneligibleReason[] = [];
    let eligible = a.amount;

    const disqualify = (reason: IneligibleReason) => {
      reasons.push(reason);
      ineligibleByReason[reason] += eligible;
      eligible = 0;
    };

    if (a.disputed) disqualify("disputed");
    else if (a.retainage && !policy.retainageEligible) disqualify("retainage");
    else if (a.foreign && !policy.foreignEligible) disqualify("foreign");
    else if (a.government && !policy.governmentEligible) disqualify("government");
    else if (a.affiliate && !policy.affiliateEligible) disqualify("affiliate");
    else if (a.daysPastInvoice > policy.over90ExcludedDays) disqualify("over_90");
    else if (crossAgedCustomers.has(a.customerId)) disqualify("cross_aged");

    // Contra reduces (does not zero) an otherwise-eligible account.
    if (eligible > 0 && a.contra && a.contra > 0) {
      const contraApplied = Math.min(eligible, a.contra);
      ineligibleByReason.contra += contraApplied;
      eligible -= contraApplied;
      reasons.push("contra");
    }

    evaluated.push({ customerId: a.customerId, amount: a.amount, eligible, ineligible: a.amount - eligible, reasons });
  }

  // Pass 2: concentration cap against total pre-concentration eligible.
  const preConcentrationEligible = evaluated.reduce((s, e) => s + e.eligible, 0);
  const cap = policy.concentrationCapPct * preConcentrationEligible;
  // Aggregate eligible per customer, then trim the overage proportionally.
  const custEligible = new Map<string, number>();
  for (const e of evaluated) custEligible.set(e.customerId, (custEligible.get(e.customerId) ?? 0) + e.eligible);

  for (const [cust, elig] of custEligible) {
    if (cap <= 0 || elig <= cap) continue;
    const overage = elig - cap;
    ineligibleByReason.concentration_cap += overage;
    // Trim the customer's accounts proportionally so per-account eligible stays consistent.
    let remainingToTrim = overage;
    for (const e of evaluated) {
      if (e.customerId !== cust || e.eligible <= 0 || remainingToTrim <= 0) continue;
      const trim = Math.min(e.eligible, (e.eligible / elig) * overage);
      const applied = Math.min(trim, remainingToTrim);
      e.eligible -= applied;
      e.ineligible += applied;
      if (!e.reasons.includes("concentration_cap")) e.reasons.push("concentration_cap");
      remainingToTrim -= applied;
    }
  }

  const eligibleBeforeReserves = evaluated.reduce((s, e) => s + e.eligible, 0);
  const dilutionReserve = policy.dilutionReservePct * eligibleBeforeReserves;
  const netEligible = Math.max(0, eligibleBeforeReserves - dilutionReserve);
  const borrowingBaseAvailability = netEligible * policy.advanceRate;

  const collateralShortfall =
    outstandingLoan != null && outstandingLoan > 0
      ? Math.max(0, outstandingLoan - borrowingBaseAvailability)
      : outstandingLoan != null
        ? 0
        : null;

  return {
    grossAr,
    agingBuckets,
    ineligibleByReason,
    eligibleBeforeReserves,
    dilutionReserve,
    netEligible,
    advanceRate: policy.advanceRate,
    borrowingBaseAvailability,
    collateralShortfall,
    accounts: evaluated,
  };
}
