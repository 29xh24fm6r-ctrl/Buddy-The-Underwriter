/**
 * Shared helpers for flag modules.
 * Pure functions — no DB, no server imports.
 */

import type { SpreadFlag, FlagSeverity, FlagCategory, BorrowerQuestion } from "./types";

let flagCounter = 0;

/** Reset counter — useful in tests */
export function resetFlagCounter(): void {
  flagCounter = 0;
}

/** Generate a deterministic flag ID from deal + trigger + year */
export function makeFlagId(dealId: string, triggerType: string, year?: number): string {
  flagCounter++;
  const suffix = year ? `_${year}` : `_${flagCounter}`;
  return `flag_${dealId.slice(0, 8)}_${triggerType}${suffix}`;
}

/** Generate a question ID from flag ID */
export function makeQuestionId(flagId: string): string {
  return `q_${flagId}`;
}

/** Build a complete SpreadFlag from parts */
export function buildFlag(params: {
  dealId: string;
  triggerType: string;
  category: FlagCategory;
  severity: FlagSeverity;
  canonicalKeys: string[];
  observedValue: number | string | null;
  expectedRange?: { min?: number; max?: number; description: string };
  yearObserved?: number;
  bankerSummary: string;
  bankerDetail: string;
  bankerImplication: string;
  borrowerQuestion: BorrowerQuestion | null;
}): SpreadFlag {
  const now = new Date().toISOString();
  return {
    flag_id: makeFlagId(params.dealId, params.triggerType, params.yearObserved),
    deal_id: params.dealId,
    category: params.category,
    severity: params.severity,
    trigger_type: params.triggerType,
    canonical_keys_involved: params.canonicalKeys,
    observed_value: params.observedValue,
    expected_range: params.expectedRange,
    year_observed: params.yearObserved,
    banker_summary: params.bankerSummary,
    banker_detail: params.bankerDetail,
    banker_implication: params.bankerImplication,
    borrower_question: params.borrowerQuestion,
    status: "open",
    auto_generated: true,
    created_at: now,
    updated_at: now,
  };
}

/** Safely read a numeric value from facts or ratios */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Format a number for display */
export function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format as dollar amount */
export function fmtDollars(n: number): string {
  return "$" + Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Format as percentage */
export function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}
