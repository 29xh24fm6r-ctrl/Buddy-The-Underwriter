/**
 * SPEC-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-AND-ADS-MATERIALIZATION-1
 *
 * Pure core of computeTotalDebtService — NO "server-only", so the period-date,
 * total, write-result and supersession decisions are unit-testable without a DB.
 *
 * Root cause this fixes: computeTotalDebtService wrote ANNUAL_DEBT_SERVICE_*
 * facts through upsertDealFinancialFact WITHOUT a valid factPeriodStart/End, so
 * the write defaulted to the 1900-01-01 sentinel and was silently rejected as
 * invalid_period_date — the canonical ANNUAL_DEBT_SERVICE total never landed.
 */

/**
 * Minimum valid financial period date — mirrors writeFact.ts MIN_VALID_PERIOD_DATE
 * (1990-01-01). Duplicated here (not imported) because writeFact.ts is server-only
 * and this core must stay pure/unit-testable. No real financial doc predates this.
 */
export const MIN_VALID_PERIOD_DATE = "1990-01-01";

/**
 * Resolve a VALID fact period / as-of date for structural ADS facts.
 *
 * Prefers the latest structural-pricing `computed_at` date (the date the
 * proposed ADS was actually priced) and falls back to today. NEVER returns a
 * sentinel/invalid date (≤ MIN_VALID_PERIOD_DATE) — upsertDealFinancialFact
 * rejects those as invalid_period_date, which is exactly the silent-skip bug.
 */
export function resolveAdsPeriodDate(
  computedAt: string | null | undefined,
  today: string,
): string {
  const fromComputed = computedAt ? String(computedAt).slice(0, 10) : null;
  if (
    fromComputed &&
    /^\d{4}-\d{2}-\d{2}$/.test(fromComputed) &&
    fromComputed > MIN_VALID_PERIOD_DATE
  ) {
    return fromComputed;
  }
  return today;
}

export type AdsExistingRow = {
  annual_debt_service: number | null;
  monthly_payment: number | null;
};

export type AdsTotals = {
  proposed: number | null;
  existing: number | null;
  total: number | null;
  existingDebtRowsPresent: boolean;
};

/**
 * Compute proposed / existing / total annual debt service from the latest
 * structural-pricing proposed value and the existing-debt schedule rows.
 *
 * - skipExistingDebt → existing treated as 0.
 * - existing = Σ(annual_debt_service ?? monthly_payment×12); all-null rows → null.
 * - total = proposed + existing when either side is present, else null.
 */
export function computeAdsTotals(args: {
  proposed: number | null;
  existingRows: AdsExistingRow[] | null;
  skipExistingDebt?: boolean;
}): AdsTotals {
  const proposed = args.proposed ?? null;
  let existing: number | null = null;
  let existingDebtRowsPresent = false;

  if (args.skipExistingDebt) {
    existing = 0;
  } else {
    const rows = args.existingRows ?? [];
    existingDebtRowsPresent = rows.length > 0;
    if (rows.length > 0) {
      existing = 0;
      for (const row of rows) {
        if (row.annual_debt_service != null) {
          existing += Number(row.annual_debt_service);
        } else if (row.monthly_payment != null) {
          existing += Number(row.monthly_payment) * 12;
        }
      }
      if (existing === 0 && rows.length > 0) {
        existing = null; // all rows had null payments
      }
    }
  }

  const total =
    proposed != null || existing != null ? (proposed ?? 0) + (existing ?? 0) : null;

  return { proposed, existing, total, existingDebtRowsPresent };
}

/** Outcome of a single canonical fact write attempt. */
export type AdsWriteOutcome = {
  key: string;
  ok: boolean;
  error?: string;
  skipped?: boolean;
  /** Required writes must succeed; their failure fails the whole compute loudly. */
  required: boolean;
};

/**
 * Inspect the ADS write results. A REQUIRED write that was skipped (e.g.
 * invalid_period_date) or failed must surface loudly rather than being swallowed
 * behind an ok:true with a missing fact.
 */
export function summarizeAdsWriteResults(outcomes: AdsWriteOutcome[]): {
  ok: boolean;
  diagnostics: string[];
} {
  const failures = outcomes.filter((o) => o.required && !o.ok);
  const diagnostics = failures.map(
    (o) => `${o.key} write ${o.skipped ? "skipped" : "failed"}: ${o.error ?? "unknown"}`,
  );
  return { ok: failures.length === 0, diagnostics };
}

export type ExistingAdsFactRow = {
  id: string;
  fact_key: string;
  owner_type?: string | null;
  fact_period_end?: string | null;
  is_superseded?: boolean | null;
};

/**
 * Decide which prior active DEAL-owned ADS/DSCR facts must be superseded after a
 * fresh write. A fresh canonical value (e.g. ANNUAL_DEBT_SERVICE_PROPOSED =
 * 101,250 priced today) must not coexist with a stale active sibling (75,000
 * written under a different / sentinel period), or the stale value can resurface
 * downstream. Returns the ids of every active same-key DEAL fact whose period
 * differs from the freshly written period.
 *
 * Scoped strictly to the keys we just wrote (ADS/DSCR family) so unrelated
 * review blockers (CASH_FLOW_AVAILABLE, PFS, YTD source-detail facts) are never
 * touched.
 */
export function staleAdsFactsToSupersede(args: {
  existing: ExistingAdsFactRow[];
  writtenKeys: string[];
  freshPeriodEnd: string;
}): string[] {
  const keys = new Set(args.writtenKeys);
  return args.existing
    .filter(
      (r) =>
        keys.has(r.fact_key) &&
        (r.owner_type ?? "DEAL") === "DEAL" &&
        r.is_superseded !== true &&
        (r.fact_period_end ?? "") !== args.freshPeriodEnd,
    )
    .map((r) => r.id);
}
