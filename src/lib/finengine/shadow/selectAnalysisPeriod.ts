/**
 * SPEC-FINENGINE-ANALYSIS-PERIOD-SELECTION-1 — shared analysis-period policy.
 *
 * The global cash flow assembler and the decision-core golden BOTH must analyze the
 * SAME single business period, or the engine and its independent golden diverge on a
 * value that is merely a period mismatch (a false UNEXPECTED). Per build principle #17,
 * the selection policy is extracted here as ONE pure helper both import.
 *
 * The bug this fixes (V-2, OmniCare `eefd62b3`): the old inline rule picked the latest
 * NON-sentinel business period — `2026-04-28`, an AR-aging report date carrying ZERO
 * income facts — so business EBITDA resolved to 0 and the global DSCR collapsed onto the
 * guarantor. The corrected rule requires the period to be INCOME-BEARING and a FULL
 * ANNUAL CYCLE (OmniCare → `2025-12-31`).
 *
 * NG2-safe for the golden to import: this is selection *policy* (like the single-count
 * rule), NOT engine output. It imports `coreOperatingEarnings` only as the income
 * PREDICATE (does a base resolve?) — never `computeGlobalCashFlow` / `stressEngine` /
 * `dealSpread`. A source-grep guard proves it. Pure; read-only (NG1). Never invents a
 * period, never annualizes, never borrows across periods (NG3).
 */

import { coreOperatingEarnings } from "@/lib/finengine/methods/foundation";
import { SENTINEL_PERIOD, type CertifiedPeriodSnapshot } from "@/lib/finengine/shadow/dealInputAdapter";

/** Full annual cycle window in days: tolerates 364/365 and short leap variance. */
const ANNUAL_DAYS_MIN = 350; // ~12 months
const ANNUAL_DAYS_MAX = 380;

export type PeriodSelection = {
  period: string;
  basis: "annual" | "stub-fallback" | "none";
  warning?: string;
};

/** Parse a 'YYYY-MM-DD' date to a UTC epoch (deterministic; no local-time drift). */
function parseISO(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "");
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Period duration in days for a snapshot, derived from its representative
 * `fiscalPeriodStart` → `fiscalPeriodEnd`. Null when the start is absent/unparseable
 * (handled by the R2 fiscal-year-end heuristic in `selectAnalysisPeriod`). Exported so
 * the assembler and golden inject the SAME duration function into the shared helper.
 */
export function periodDaysFromSnapshot(snap: CertifiedPeriodSnapshot): number | null {
  const s = parseISO(snap.fiscalPeriodStart);
  const e = parseISO(snap.fiscalPeriodEnd);
  if (s == null || e == null) return null;
  return Math.round((e - s) / 86_400_000);
}

/** A snapshot ending on a calendar year-end (Dec 31) — the fiscal-year-end proxy (R2). */
function endsOnFiscalYearEnd(snap: CertifiedPeriodSnapshot): boolean {
  return /-12-31$/.test(snap.fiscalPeriodEnd);
}

/** Income-bearing predicate: a conservative-EBITDA base resolves (value != null). */
function isIncomeBearing(snap: CertifiedPeriodSnapshot): boolean {
  // The predicate is "base resolves", NOT "EBITDA ≠ 0": a legitimately zero-income
  // annual year (base resolves to 0) is still a valid period (§0.3 / R3).
  return coreOperatingEarnings({ facts: snap.facts, entityForm: "UNKNOWN", fiscalPeriodEnd: snap.fiscalPeriodEnd }).value != null;
}

/**
 * Is this income-bearing snapshot a full annual cycle?
 *  - duration known → within the [350, 380]-day window.
 *  - duration NULL (missing/unparseable start) → R2: a year-end (Dec-31) period is
 *    treated as annual-eligible rather than silently demoted to a sub-annual stub.
 */
function isAnnual(snap: CertifiedPeriodSnapshot, days: number | null): boolean {
  if (days == null) return endsOnFiscalYearEnd(snap);
  return days >= ANNUAL_DAYS_MIN && days <= ANNUAL_DAYS_MAX;
}

/** Latest snapshot by fiscal period end (descending). */
function latest(snaps: CertifiedPeriodSnapshot[]): CertifiedPeriodSnapshot {
  return [...snaps].sort((a, b) => (a.fiscalPeriodEnd < b.fiscalPeriodEnd ? 1 : a.fiscalPeriodEnd > b.fiscalPeriodEnd ? -1 : 0))[0];
}

/**
 * Select the business analysis period for the global cash flow / decision core.
 *
 * Rule (most conservative, actual-historical):
 *   0. an explicit `opts.analysisPeriod` wins verbatim (tests/overrides), basis "annual".
 *   1. candidates = BUSINESS snapshots that are NON-sentinel AND income-bearing
 *      (coreOperatingEarnings resolves a base) — excludes AR-aging / balance-sheet-only.
 *   2. prefer the LATEST candidate whose duration is a FULL ANNUAL CYCLE (~350–380 days).
 *   3. else fall back to the LATEST income-bearing stub, warning that the period is
 *      sub-annual and cash flow is NOT annualized (annualization = projection, excluded).
 *   4. else no income-bearing period → basis "none" + warning (caller treats business
 *      cash flow as 0, as before).
 *
 * `periodDaysOf` is injected so the helper stays pure and testable.
 */
export function selectAnalysisPeriod(
  businessSnaps: CertifiedPeriodSnapshot[],
  periodDaysOf: (snap: CertifiedPeriodSnapshot) => number | null,
  opts?: { analysisPeriod?: string },
): PeriodSelection {
  // 0. explicit injection is authoritative.
  if (opts?.analysisPeriod) return { period: opts.analysisPeriod, basis: "annual" };

  // 1. income-bearing, non-sentinel candidates.
  const candidates = businessSnaps.filter((s) => s.fiscalPeriodEnd !== SENTINEL_PERIOD && isIncomeBearing(s));

  if (candidates.length === 0) {
    // 4. nothing income-bearing — never invent a period; caller treats business cash as 0.
    return {
      period: SENTINEL_PERIOD,
      basis: "none",
      warning:
        "no income-bearing BUSINESS period (all business snapshots are AR-aging / balance-sheet-only / empty) — business cash flow treated as 0.",
    };
  }

  // 2. prefer the latest full-annual-cycle candidate.
  const annual = candidates.filter((s) => isAnnual(s, periodDaysOf(s)));
  if (annual.length > 0) {
    const win = latest(annual);
    // R2: surface reliance on the fiscal-year-end heuristic when duration is unknown —
    // never demote a legitimate annual period to stub silently.
    const warning =
      periodDaysOf(win) == null
        ? `analysis period ${win.fiscalPeriodEnd}: no period-start date — admitted as annual on the fiscal-year-end (Dec-31) heuristic (duration unverifiable).`
        : undefined;
    return { period: win.fiscalPeriodEnd, basis: "annual", warning };
  }

  // 3. stub fallback — latest income-bearing sub-annual period, never annualized.
  const win = latest(candidates);
  return {
    period: win.fiscalPeriodEnd,
    basis: "stub-fallback",
    warning: `no full-annual-cycle BUSINESS period — falling back to the latest income-bearing stub ${win.fiscalPeriodEnd} (sub-annual; cash flow NOT annualized). Global DSCR is a sub-annual figure.`,
  };
}
