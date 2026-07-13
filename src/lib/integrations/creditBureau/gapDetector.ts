import type { ParsedTradeline } from "./parser";

/**
 * SPEC S4 B-1 — pure abnormality detector. Feeds `deal_gap_queue` via
 * request.ts; no new UI (principle #23 — existing Story tab / Borrower
 * Voice flow handles explanation capture).
 */

export type AbnormalityType =
  | "charge_off"
  | "collection"
  | "recent_delinquency"
  | "mild_delinquency"
  | "high_utilization"
  | "excessive_inquiries"
  | "large_unsecured_debt";

export type Severity = "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type Abnormality = {
  tradeline_index: number;
  abnormality_type: AbnormalityType;
  severity: Severity;
  suggested_explanation_prompt: string;
};

const RECENT_DELINQUENCY_PATTERN = /[3-9]/;
const MILD_DELINQUENCY_PATTERN = /2/;
const LARGE_UNSECURED_DEBT_THRESHOLD = 100_000;
const HIGH_UTILIZATION_RATIO = 0.85;

function last12Months(paymentHistory24mo: string | null): string {
  if (!paymentHistory24mo) return "";
  return paymentHistory24mo.slice(0, 12);
}

function fmtMoney(n: number | null): string {
  return n == null ? "an unknown amount" : `$${n.toLocaleString("en-US")}`;
}

/**
 * `inquiries24moCount` is report-level (not per-tradeline), so it's passed
 * separately rather than derived from the tradelines array.
 */
export function detectAbnormalities(
  tradelines: ParsedTradeline[],
  inquiries24moCount = 0,
): Abnormality[] {
  const abnormalities: Abnormality[] = [];

  tradelines.forEach((t, index) => {
    const creditor = t.creditor_name ?? "an account";

    if (t.is_charged_off) {
      abnormalities.push({
        tradeline_index: index,
        abnormality_type: "charge_off",
        severity: "HIGH",
        suggested_explanation_prompt: `We see a charged-off account from ${creditor} for ${fmtMoney(t.current_balance)}. Tell us what happened.`,
      });
    }

    if (t.is_in_collection) {
      abnormalities.push({
        tradeline_index: index,
        abnormality_type: "collection",
        severity: "HIGH",
        suggested_explanation_prompt: `There's a collection account with ${creditor}. What's the story?`,
      });
    }

    if (!t.is_charged_off && !t.is_in_collection) {
      const recent = last12Months(t.payment_history_24mo);
      if (RECENT_DELINQUENCY_PATTERN.test(recent)) {
        abnormalities.push({
          tradeline_index: index,
          abnormality_type: "recent_delinquency",
          severity: "HIGH",
          suggested_explanation_prompt: `We see a 60-day-or-worse late on ${creditor} in the last 12 months. What was going on at that time?`,
        });
      } else if (MILD_DELINQUENCY_PATTERN.test(recent)) {
        abnormalities.push({
          tradeline_index: index,
          abnormality_type: "mild_delinquency",
          severity: "MEDIUM",
          suggested_explanation_prompt: `We see a 30-day late on ${creditor} in the last 12 months. What happened?`,
        });
      }
    }

    if (
      t.account_type === "credit_card" &&
      t.current_balance != null &&
      t.high_credit != null &&
      t.high_credit > 0 &&
      t.current_balance / t.high_credit > HIGH_UTILIZATION_RATIO
    ) {
      abnormalities.push({
        tradeline_index: index,
        abnormality_type: "high_utilization",
        severity: "MEDIUM",
        suggested_explanation_prompt: `${creditor} is carrying a high balance relative to its limit. Any context on that?`,
      });
    }

    if (
      t.account_type !== "mortgage" &&
      t.current_balance != null &&
      t.current_balance > LARGE_UNSECURED_DEBT_THRESHOLD
    ) {
      abnormalities.push({
        tradeline_index: index,
        abnormality_type: "large_unsecured_debt",
        severity: "INFO",
        suggested_explanation_prompt: `${creditor} shows a balance over ${fmtMoney(LARGE_UNSECURED_DEBT_THRESHOLD)}. Can you tell us what this is for?`,
      });
    }
  });

  if (inquiries24moCount > 6) {
    abnormalities.push({
      tradeline_index: -1,
      abnormality_type: "excessive_inquiries",
      severity: "LOW",
      suggested_explanation_prompt: `We see ${inquiries24moCount} credit inquiries in the last 24 months. Were you shopping for financing recently?`,
    });
  }

  return abnormalities;
}
