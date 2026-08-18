/**
 * SBA size eligibility — five-state evaluator.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 2.
 *
 * ─── The rule this replaces ─────────────────────────────────────────────
 * The old evaluator returned a boolean. A NAICS code missing from its
 * 52-entry placeholder table produced `passed: false`, which was
 * indistinguishable downstream from "this business is too large" — so an
 * internal data gap was reported to borrowers as an SBA size denial. Every
 * score ever computed in production came back not-eligible.
 *
 * ─── The rule now ───────────────────────────────────────────────────────
 * ONLY `ineligible` means the borrower failed the size requirement, and it
 * requires an affirmative measured breach of BOTH applicable standards.
 * `needs_information`, `classification_unresolved` and `data_error` block
 * sealing as unresolved requirements — they never assert ineligibility and
 * never make a borrower eligible by default.
 *
 * ─── Two standards, either qualifies (13 CFR §121.301(b)) ───────────────
 * For 7(a) and 504, an applicant must meet ONE of:
 *   (1) the §121.201 industry standard for its primary industry, or
 *   (2) the alternative size standard — including affiliates, tangible net
 *       worth not exceeding $20,000,000 AND average net income after
 *       federal income taxes (excluding carry-over losses) for the two
 *       preceding completed fiscal years not exceeding $6,500,000.
 *
 * This is a LENDING rule and has no federal-contracting equivalent. Buddy
 * previously implemented only (1), so borrowers who exceeded their industry
 * threshold but qualified under (2) were wrongly failed.
 *
 * §121.201's preamble states the standard is the MAXIMUM allowed, so the
 * comparison is `observed <= threshold` — a concern exactly at the
 * threshold is small.
 *
 * Exception rows are surfaced, not auto-applied: when a NAICS carries
 * §121.201 exceptions, which one applies depends on what the business
 * actually does, and that is a human determination. The base standard is
 * evaluated and the exceptions are attached for review.
 */

import { lookupRecords, getDataset } from "@/lib/reference/sba/dataset";
import type { SbaSizeStandardRecord } from "@/lib/reference/sba/types";

export type SizeEligibilityState =
  | "eligible"
  | "ineligible"
  | "needs_information"
  | "classification_unresolved"
  | "data_error";

export type SizeEligibilityOutcome = {
  state: SizeEligibilityState;
  /** True ONLY for `eligible`. Nothing else satisfies the requirement. */
  satisfied: boolean;
  /** True ONLY for `ineligible`. Drives borrower-facing denial language. */
  failedRequirement: boolean;
  reason: string;
  /** What the borrower must do next, when the state is resolvable. */
  nextAction: string | null;
  matchedRecord: SbaSizeStandardRecord | null;
  /** Exception rows on this NAICS that a human must consider. */
  exceptions: SbaSizeStandardRecord[];
  qualifiedUnder: "industry_standard" | "alternative_size_standard" | null;
  observedValue: number | null;
  thresholdValue: number | null;
};

/** 13 CFR §121.301(b)(2), current values. */
export const ALT_TANGIBLE_NET_WORTH_MAX_USD = 20_000_000;
export const ALT_AVG_NET_INCOME_MAX_USD = 6_500_000;

export type SizeEligibilityInputs = {
  naics: string | null;
  /** Applicant + affiliates, per §121.301. */
  annualReceiptsUsd: number | null;
  employeeCount: number | null;
  totalAssetsUsd: number | null;
  /** Alternative size standard inputs (§121.301(b)(2)). */
  tangibleNetWorthUsd?: number | null;
  avgNetIncomeTwoYearUsd?: number | null;
};

function outcome(partial: Partial<SizeEligibilityOutcome> & {
  state: SizeEligibilityState;
  reason: string;
}): SizeEligibilityOutcome {
  return {
    satisfied: partial.state === "eligible",
    failedRequirement: partial.state === "ineligible",
    nextAction: null,
    matchedRecord: null,
    exceptions: [],
    qualifiedUnder: null,
    observedValue: null,
    thresholdValue: null,
    ...partial,
  };
}

/**
 * Evaluates the alternative size standard. Returns null when the inputs
 * needed to evaluate it were not supplied — absence of data is never
 * treated as failure of this test.
 */
function meetsAlternativeStandard(
  inputs: SizeEligibilityInputs,
): boolean | null {
  const { tangibleNetWorthUsd: tnw, avgNetIncomeTwoYearUsd: netIncome } = inputs;
  if (tnw == null || netIncome == null) return null;
  return (
    tnw <= ALT_TANGIBLE_NET_WORTH_MAX_USD &&
    netIncome <= ALT_AVG_NET_INCOME_MAX_USD
  );
}

export function evaluateSizeEligibility(
  inputs: SizeEligibilityInputs,
): SizeEligibilityOutcome {
  // ── Reference data available? ───────────────────────────────────────
  const dataset = getDataset();
  if (!dataset.ok) {
    return outcome({
      state: "data_error",
      reason:
        "SBA size-standard reference data is unavailable, so the size test could " +
        "not be run. This is a system issue, not a finding about this business.",
      nextAction: null,
    });
  }

  // ── Classification resolved? ────────────────────────────────────────
  const naics = (inputs.naics ?? "").trim();
  if (!naics) {
    return outcome({
      state: "classification_unresolved",
      reason: "Industry classification (NAICS) has not been confirmed yet.",
      nextAction: "Confirm the business's industry classification.",
    });
  }

  const records = lookupRecords(naics);
  if (records.length === 0) {
    return outcome({
      state: "classification_unresolved",
      reason:
        `NAICS ${naics} is not in the current SBA size-standard table ` +
        `(effective ${dataset.dataset.effectiveDate}). The classification needs to ` +
        `be confirmed before the size test can run.`,
      nextAction: "Re-confirm the industry classification.",
    });
  }

  const base = records.find((r) => r.exceptionLabel == null) ?? records[0];
  const exceptions = records.filter((r) => r.exceptionLabel != null);

  // ── Which measure, and do we have it? ───────────────────────────────
  let observed: number | null;
  let threshold: number | null;
  let unitLabel: string;

  switch (base.measure) {
    case "annual_receipts":
      observed = inputs.annualReceiptsUsd;
      threshold = (base.receiptsMillionsUsd ?? 0) * 1_000_000;
      unitLabel = "average annual receipts";
      break;
    case "employees":
      observed = inputs.employeeCount;
      threshold = base.employees;
      unitLabel = "employees";
      break;
    case "assets":
      observed = inputs.totalAssetsUsd;
      threshold = (base.assetsMillionsUsd ?? 0) * 1_000_000;
      unitLabel = "total assets";
      break;
    default:
      return outcome({
        state: "data_error",
        reason:
          `NAICS ${naics} has no usable size measure in the reference data. ` +
          `Flagged for review; this is not a finding about the business.`,
        matchedRecord: base,
        exceptions,
      });
  }

  const alt = meetsAlternativeStandard(inputs);

  if (observed == null) {
    // The industry test cannot run — but the alternative standard alone can
    // still establish eligibility (§121.301(b) is either/or).
    if (alt === true) {
      return outcome({
        state: "eligible",
        reason:
          `Qualifies under the SBA alternative size standard (tangible net worth ` +
          `at or below $20M and two-year average net income at or below $6.5M).`,
        matchedRecord: base,
        exceptions,
        qualifiedUnder: "alternative_size_standard",
      });
    }

    return outcome({
      state: "needs_information",
      reason:
        `The SBA standard for ${base.title} (NAICS ${naics}) is measured in ` +
        `${unitLabel}, which has not been provided yet.`,
      nextAction:
        base.measure === "employees"
          ? "Provide the number of employees, including any affiliates."
          : base.measure === "assets"
            ? "Provide total assets."
            : "Provide average annual receipts, including any affiliates.",
      matchedRecord: base,
      exceptions,
      thresholdValue: threshold,
    });
  }

  if (threshold == null) {
    return outcome({
      state: "data_error",
      reason: `Reference data for NAICS ${naics} is missing a threshold value.`,
      matchedRecord: base,
      exceptions,
    });
  }

  // ── The measured test ───────────────────────────────────────────────
  if (observed <= threshold) {
    return outcome({
      state: "eligible",
      reason:
        `Within the SBA size standard for ${base.title} (NAICS ${naics}): ` +
        `${formatValue(observed, base.measure)} against a maximum of ` +
        `${formatValue(threshold, base.measure)}.`,
      matchedRecord: base,
      exceptions,
      qualifiedUnder: "industry_standard",
      observedValue: observed,
      thresholdValue: threshold,
    });
  }

  // Over the industry standard — the alternative standard can still qualify.
  if (alt === true) {
    return outcome({
      state: "eligible",
      reason:
        `Exceeds the industry size standard for NAICS ${naics}, but qualifies ` +
        `under the SBA alternative size standard for 7(a)/504.`,
      matchedRecord: base,
      exceptions,
      qualifiedUnder: "alternative_size_standard",
      observedValue: observed,
      thresholdValue: threshold,
    });
  }

  if (alt === null) {
    // Over on industry, and we cannot evaluate the alternative. Asserting
    // ineligibility here would be the old bug in a new place.
    return outcome({
      state: "needs_information",
      reason:
        `${formatValue(observed, base.measure)} exceeds the SBA standard for ` +
        `${base.title} (maximum ${formatValue(threshold, base.measure)}). SBA also ` +
        `allows an alternative size standard for 7(a)/504, which cannot be ` +
        `evaluated without tangible net worth and two-year average net income.`,
      nextAction:
        "Provide tangible net worth and average net income for the last two " +
        "completed fiscal years.",
      matchedRecord: base,
      exceptions,
      observedValue: observed,
      thresholdValue: threshold,
    });
  }

  return outcome({
    state: "ineligible",
    reason:
      `${formatValue(observed, base.measure)} exceeds the SBA size standard for ` +
      `${base.title} (NAICS ${naics}, maximum ${formatValue(threshold, base.measure)}), ` +
      `and the business does not meet the alternative size standard ` +
      `(tangible net worth at or below $20M and two-year average net income at ` +
      `or below $6.5M).`,
    matchedRecord: base,
    exceptions,
    observedValue: observed,
    thresholdValue: threshold,
  });
}

function formatValue(value: number, measure: SbaSizeStandardRecord["measure"]): string {
  if (measure === "employees") return `${value.toLocaleString()} employees`;
  return `$${value.toLocaleString()}`;
}
