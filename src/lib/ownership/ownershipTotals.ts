/**
 * Ownership totals — one definition of "does this cap table add up?"
 *
 * WHY THIS EXISTS.
 *
 * Deal b296dec2 held three owner rows summing to 149%: Sebrina Colon 51%,
 * Matthew Paller 49%, and a duplicate "matt paller" 49% created two days
 * later. Nothing in the product noticed. `handleSaveOwnership` validated
 * the 100% total of the payload it was handed, but nothing ever checked
 * the total of what the DATABASE actually holds, so a total that only
 * becomes wrong later — a duplicate row, a banker edit, a partial
 * propagation — sailed straight through to the sealing gate.
 *
 * A cap table that does not total 100% must never reach a lender: it is
 * either missing an owner (an unidentified guarantor) or double-counting
 * one (an unsatisfiable identity-verification blocker). Both are grounds
 * for an SBA decline, and both are cheap to catch here.
 *
 * Shared, pure, and free of "server-only" so the borrower's intake form
 * warns with exactly the arithmetic the sealing gate blocks on.
 */

import { clusterOwnerNames, type OwnerNameCandidate } from "@/lib/ownership/ownerNameMatch";

/**
 * Floating-point tolerance on the 100% total. Percentages arrive as
 * user-typed decimals and as Postgres numerics, so an exact === is not
 * safe; 0.01 is tighter than any real cap table's precision.
 */
export const OWNERSHIP_TOTAL_TOLERANCE = 0.01;

export type OwnershipRow = OwnerNameCandidate & {
  ownership_pct?: number | string | null;
};

export type OwnershipIssue =
  | { code: "total_mismatch"; totalPct: number; message: string }
  | { code: "duplicate_owner"; names: string[]; message: string }
  | { code: "no_owners"; message: string }
  | { code: "invalid_pct"; names: string[]; message: string };

export type OwnershipSummary = {
  /** Sum of every row that carries a usable percentage. */
  totalPct: number;
  /** How many rows carried a usable percentage. */
  countedRows: number;
  /** Rows whose percentage is null/blank — not counted, not an error. */
  uncountedRows: number;
  /** True when there is nothing to judge (no owners, or none with a pct). */
  indeterminate: boolean;
  ok: boolean;
  issues: OwnershipIssue[];
};

function toPct(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function formatPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Summarize a cap table.
 *
 * `indeterminate` is the important subtlety: a deal whose owner rows have
 * no percentages recorded yet is not a deal with a WRONG total. Reporting
 * "ownership totals 0%" on a solo owner whose pct was never written would
 * block sealing on data the borrower was never asked for. Callers should
 * treat `indeterminate` as "nothing to say", not as a failure.
 */
export function summarizeOwnership(rows: readonly OwnershipRow[]): OwnershipSummary {
  const issues: OwnershipIssue[] = [];

  const withPct: Array<{ row: OwnershipRow; pct: number }> = [];
  const invalidNames: string[] = [];
  let uncountedRows = 0;

  for (const row of rows) {
    const pct = toPct(row.ownership_pct);
    if (pct == null) {
      uncountedRows += 1;
      continue;
    }
    if (pct <= 0 || pct > 100) {
      invalidNames.push(String(row.display_name ?? "An owner"));
      continue;
    }
    withPct.push({ row, pct });
  }

  const totalPct = withPct.reduce((sum, o) => sum + o.pct, 0);
  const rounded = Math.round(totalPct * 100) / 100;

  if (invalidNames.length > 0) {
    issues.push({
      code: "invalid_pct",
      names: invalidNames,
      message: `${invalidNames.join(", ")} ${
        invalidNames.length === 1 ? "has" : "have"
      } an ownership percentage outside 0–100%.`,
    });
  }

  // Same-person duplicates. Reported separately from the total because
  // they are the usual CAUSE of a wrong total, and naming them is what
  // lets the borrower fix it in one step instead of guessing.
  for (const cluster of clusterOwnerNames(rows)) {
    if (cluster.length < 2) continue;
    const names = cluster.map((r) => String(r.display_name ?? "An owner"));
    issues.push({
      code: "duplicate_owner",
      names,
      message: `${names.join(" and ")} look like the same person listed more than once.`,
    });
  }

  if (rows.length === 0) {
    issues.push({ code: "no_owners", message: "No owners have been recorded yet." });
    return {
      totalPct: 0,
      countedRows: 0,
      uncountedRows: 0,
      indeterminate: true,
      ok: false,
      issues,
    };
  }

  const indeterminate = withPct.length === 0 && invalidNames.length === 0;

  if (!indeterminate && Math.abs(rounded - 100) > OWNERSHIP_TOTAL_TOLERANCE) {
    issues.push({
      code: "total_mismatch",
      totalPct: rounded,
      message:
        rounded > 100
          ? `Ownership adds up to ${formatPct(rounded)}% — that's ${formatPct(
              Math.round((rounded - 100) * 100) / 100,
            )}% too much.`
          : `Ownership adds up to ${formatPct(rounded)}% — ${formatPct(
              Math.round((100 - rounded) * 100) / 100,
            )}% is still unaccounted for.`,
    });
  }

  return {
    totalPct: rounded,
    countedRows: withPct.length,
    uncountedRows,
    indeterminate,
    ok: issues.length === 0,
    issues,
  };
}
