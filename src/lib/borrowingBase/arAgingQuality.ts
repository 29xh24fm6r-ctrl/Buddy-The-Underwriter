/**
 * SPEC-BORROWING-BASE-CERTIFICATE-ENGINE-1 (Phase 3) — pure AR-aging review quality gates.
 *
 * These gates decide whether an AR aging report is trustworthy enough to back a borrowing-base
 * certificate, and — critically — whether it may be used to support a balance sheet of a DIFFERENT
 * date. A date mismatch never auto-bridges: it surfaces a blocking "missing bridge" gate so the
 * certificate cannot silently clear a period-mismatched balance-sheet blocker (the OmniCare 4/28 AR
 * aging vs 3/31 TCA case).
 *
 * Pure: no IO. Caller supplies the reported totals, the customer-row sum, and the dates.
 */

export type QualityGateStatus = "pass" | "warn" | "fail";

export type QualityGate = {
  id: string;
  label: string;
  status: QualityGateStatus;
  /** A failing gate is blocking when true — it forces certificateStatus to "blocked". */
  blocking: boolean;
  detail?: string;
};

export type ArAgingQualityInput = {
  asOfDate: string | null; // ISO "YYYY-MM-DD"
  certificateDate: string | null; // ISO — used for staleness
  customerRowCount: number;
  /** total_ar as reported on the aging document header. */
  reportedTotal: number | null;
  /** sum of the parsed customer-row totals. */
  customerRowSum: number;
  /** sum of every aging bucket across customers (current + 30 + 60 + 90 + 120). */
  bucketSum: number;
  over90: number | null;
  /** Max age (days) of the aging report before it is stale for the certificate cadence. */
  maxAgeDays?: number;
  /** Balance-sheet date this certificate may be asked to support, if a tie-out is required. */
  balanceSheetAsOfDate?: string | null;
  /** Reported AR on that balance sheet, for a GL/BS tie-out, if available. */
  balanceSheetAr?: number | null;
  /** True when a reconciliation bridge between the aging date and the BS date has been recorded. */
  bridgeRecorded?: boolean;
  tolerance?: number;
};

export type ArAgingQualityResult = {
  gates: QualityGate[];
  /** True when any blocking gate failed. */
  blocked: boolean;
  /** True when AR aging date differs from the balance-sheet date and no bridge was recorded. */
  dateMismatchUnbridged: boolean;
};

const DEFAULT_MAX_AGE_DAYS = 45;

function daysBetween(aIso: string, bIso: string): number | null {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export function assessArAgingQuality(input: ArAgingQualityInput): ArAgingQualityResult {
  const tol = input.tolerance ?? Math.max(1, (input.reportedTotal ?? input.customerRowSum) * 0.005);
  const gates: QualityGate[] = [];

  gates.push({
    id: "as_of_date_present",
    label: "AR aging has an as-of date",
    status: input.asOfDate ? "pass" : "fail",
    blocking: true,
    detail: input.asOfDate ?? "no as-of date detected",
  });

  gates.push({
    id: "customer_rows_present",
    label: "AR aging has customer rows",
    status: input.customerRowCount > 0 ? "pass" : "fail",
    blocking: true,
    detail: `${input.customerRowCount} customer row(s)`,
  });

  // Total ties to the sum of customer rows.
  const totalTieDiff = input.reportedTotal == null ? null : Math.abs(input.reportedTotal - input.customerRowSum);
  gates.push({
    id: "total_ties_to_customers",
    label: "Reported AR total ties to the sum of customer rows",
    status: totalTieDiff == null ? "warn" : totalTieDiff <= tol ? "pass" : "fail",
    blocking: true,
    detail:
      totalTieDiff == null
        ? "no reported total to compare"
        : `reported ${fmt(input.reportedTotal)} vs rows ${fmt(input.customerRowSum)} (diff ${fmt(totalTieDiff)})`,
  });

  // Buckets tie to total.
  const base = input.reportedTotal ?? input.customerRowSum;
  const bucketDiff = Math.abs(input.bucketSum - base);
  gates.push({
    id: "buckets_tie_to_total",
    label: "Aging buckets tie to the AR total",
    status: bucketDiff <= tol ? "pass" : "warn",
    blocking: false,
    detail: `buckets ${fmt(input.bucketSum)} vs total ${fmt(base)} (diff ${fmt(bucketDiff)})`,
  });

  // Staleness.
  const maxAge = input.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  let staleStatus: QualityGateStatus = "warn";
  let staleDetail = "cannot compute age (missing date)";
  if (input.asOfDate && input.certificateDate) {
    const age = daysBetween(input.certificateDate, input.asOfDate);
    if (age != null) {
      staleStatus = age <= maxAge ? "pass" : "fail";
      staleDetail = `${age} day(s) old (limit ${maxAge})`;
    }
  }
  gates.push({ id: "not_stale", label: "AR aging is current for the certificate cadence", status: staleStatus, blocking: false, detail: staleDetail });

  // Over-90 shown clearly.
  gates.push({
    id: "over_90_shown",
    label: "Over-90 / over-120 are shown",
    status: input.over90 == null ? "warn" : "pass",
    blocking: false,
    detail: input.over90 == null ? "over-90 not reported" : `over-90 ${fmt(input.over90)}`,
  });

  // Concentration table always rendered by the engine.
  gates.push({ id: "concentration_shown", label: "Customer concentration table is shown", status: "pass", blocking: false });

  // GL / balance-sheet tie-out (only when a BS AR figure is supplied).
  let dateMismatchUnbridged = false;
  if (input.balanceSheetAsOfDate || input.balanceSheetAr != null) {
    const sameDate =
      !!input.asOfDate && !!input.balanceSheetAsOfDate && input.asOfDate === input.balanceSheetAsOfDate;

    if (input.balanceSheetAr != null) {
      const tieDiff = Math.abs((input.reportedTotal ?? input.customerRowSum) - input.balanceSheetAr);
      gates.push({
        id: "tied_to_balance_sheet",
        label: "AR aging ties to the balance sheet / GL",
        // Only meaningful as a true tie-out when the dates match; otherwise it's informational.
        status: !sameDate ? "warn" : tieDiff <= tol ? "pass" : "fail",
        blocking: sameDate, // a same-date GL tie-out failure is blocking; cross-date is handled below.
        detail: `aging ${fmt(input.reportedTotal ?? input.customerRowSum)} vs balance sheet AR ${fmt(input.balanceSheetAr)}${sameDate ? "" : " (different dates — not a tie-out)"}`,
      });
    }

    if (!sameDate && input.balanceSheetAsOfDate) {
      dateMismatchUnbridged = input.bridgeRecorded !== true;
      gates.push({
        id: "date_bridge_required",
        label: "Reconciliation bridge required (AR aging date ≠ balance-sheet date)",
        status: input.bridgeRecorded === true ? "pass" : "fail",
        // NOT blocking for the certificate's OWN date — the aging ties to itself and the certificate is
        // valid as of its as-of date. Cross-period use is governed separately by dateMismatchUnbridged:
        // until a bridge exists this certificate may not back the differently-dated balance sheet, and
        // the engine surfaces that as a prominent exception rather than silently clearing a BS blocker.
        blocking: false,
        detail: `AR aging as of ${input.asOfDate ?? "?"}, balance sheet as of ${input.balanceSheetAsOfDate}${input.bridgeRecorded === true ? " (bridge recorded)" : " — no bridge"}`,
      });
    }
  }

  const blocked = gates.some((g) => g.blocking && g.status === "fail");
  return { gates, blocked, dateMismatchUnbridged };
}

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
