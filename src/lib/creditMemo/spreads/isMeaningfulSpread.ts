/**
 * Phase 6 — Meaningful Spread Detection
 *
 * Centralizes the rules for which deal_spreads rows qualify as
 * committee-facing financial schedules vs. artifacts or placeholders.
 *
 * Pure function — no DB, no server-only. Safe for CI guards.
 */

import { ARTIFACT_SPREAD_TYPES } from "@/lib/creditMemo/canonical/sourcePriority";

export type SpreadRow = {
  key: string;
  label: string;
  values?: unknown[];
  notes?: string | null;
};

export type SpreadForCheck = {
  spread_type: string;
  status?: string;
  rendered_json?: {
    rows?: SpreadRow[];
    columnsV2?: unknown[];
  } | null;
};

/**
 * Returns true if a spread is a placeholder "Generating…" row.
 */
export function isPlaceholderSpread(spread: SpreadForCheck): boolean {
  const rows = spread.rendered_json?.rows ?? [];
  if (rows.length !== 1) return false;
  const row = rows[0];
  const key = String(row.key ?? "").toLowerCase();
  const label = String(row.label ?? "").toLowerCase();
  const notes = String(row.notes ?? "").toLowerCase();
  return (
    key === "status" &&
    (label.includes("generating") || label.includes("queued") ||
     notes.includes("queued for background processing"))
  );
}

/**
 * Returns true if a spread qualifies as a meaningful committee-facing
 * financial schedule. Returns false for artifacts, placeholders, and
 * empty renders.
 */
export function isMeaningfulSpread(spread: SpreadForCheck): boolean {
  // Artifact types never qualify
  if (ARTIFACT_SPREAD_TYPES.has(spread.spread_type)) return false;

  // Must have rendered rows
  const rows = spread.rendered_json?.rows ?? [];
  if (rows.length === 0) return false;

  // Placeholder spreads do not qualify
  if (isPlaceholderSpread(spread)) return false;

  return true;
}

/**
 * Zero UUID constant — used for personal spreads without a real owner entity.
 */
export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Returns a professional label suffix for the spread owner.
 * - Real owner entity → " — {name}"
 * - Zero UUID personal spread → " — Guarantor"
 * - Zero UUID deal spread → ""
 * - Null/missing → ""
 */
export function getOwnerSuffix(
  ownerEntityId: string | null,
  spreadType: string,
  ownerNames: Map<string, string>,
): string {
  if (!ownerEntityId) return "";
  if (ownerEntityId === ZERO_UUID) {
    if (spreadType === "PERSONAL_INCOME" || spreadType === "PERSONAL_FINANCIAL_STATEMENT") {
      return " — Guarantor";
    }
    return "";
  }
  const name = ownerNames.get(ownerEntityId);
  return name ? ` — ${name}` : "";
}
