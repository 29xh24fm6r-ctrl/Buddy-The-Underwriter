/**
 * SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #6 — true zero vs missing.
 *
 * A spread cell's numeric value alone cannot say whether `0` is a real reported zero (true_zero)
 * or simply absent (missing). This metadata makes the distinction explicit so the renderer never
 * globally collapses `0` to an em dash, and so blocked/derived provenance is recordable.
 *
 * Pure — no IO. The renderer's fmtNumber already distinguishes null (missing → em dash) from a
 * numeric 0 (true zero → "0"); CellState is the richer, optional channel for blocked/derived/direct.
 */

export type CellState = "missing" | "true_zero" | "blocked" | "derived" | "direct";

export type CellClassifierInput = {
  value: number | null;
  /** a source fact for this cell was present (vs. absent) */
  present?: boolean;
  /** the certification gate blocked this cell (value suppressed) */
  blocked?: boolean;
  /** the value was derived/fell back rather than read from a direct source fact */
  derived?: boolean;
};

export function classifyCell(input: CellClassifierInput): CellState {
  const { value, present = value != null, blocked = false, derived = false } = input;
  if (blocked) return "blocked";
  if (value == null) return "missing";
  if (value === 0 && present) return "true_zero";
  if (derived) return "derived";
  return "direct";
}

/** Whether a cell holds a genuine reported zero (not a blank/missing). */
export function isTrueZero(state: CellState): boolean {
  return state === "true_zero";
}
