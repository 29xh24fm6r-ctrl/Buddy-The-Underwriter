/**
 * SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1 — narrative guardrail (pure).
 *
 * Turns the spread accuracy/completion audit into (a) prompt guardrail lines that tell the model
 * not to draw strong conclusions on unreconciled rows, and (b) a deterministic data-reliability
 * caveat section prepended to the generated narrative when blocker-level findings exist. No IO —
 * kept out of the server-only narrativeEngine so it is unit-testable.
 */

import type { SpreadAuditResult } from "./audit/spreadAccuracyAudit";

export type NarrativeSectionLike = { title: string; body: string };

/** Prompt lines instructing the model to caveat (not conclude on) unreconciled rows/periods. */
export function spreadAuditGuardrailLines(audit: SpreadAuditResult | null | undefined): string[] {
  if (!audit || audit.status === "clean" || audit.blockedCells.length === 0) return [];
  const lines: string[] = [];
  lines.push("");
  lines.push("=== DATA RELIABILITY (SPREAD AUDIT) ===");
  lines.push(
    `Spread audit status: ${audit.status.toUpperCase()} (${audit.summary.blockers} blocker, ${audit.summary.warnings} warning).`,
  );
  lines.push("The following rows/periods FAILED reconciliation and are NOT reliable:");
  for (const c of audit.blockedCells) {
    lines.push(`- ${c.period} · ${c.statement.replace(/_/g, " ")} · ${c.rowLabel}`);
  }
  lines.push(
    "GUARDRAIL: Do NOT make strong or definitive statements about these rows/periods (leverage, " +
      "liabilities, profitability, or coverage that depends on them). Explicitly caveat them as " +
      "unverified/incomplete pending corrected source data. Confine confident analysis to rows that passed.",
  );
  return lines;
}

/**
 * Lead the narrative with a deterministic caveat when the audit found blocker-level exceptions,
 * regardless of what the model produced. Returns a NEW array; never mutates the input.
 */
export function withAuditCaveat<T extends NarrativeSectionLike>(
  sections: T[],
  audit: SpreadAuditResult | null | undefined,
): (T | NarrativeSectionLike)[] {
  if (!audit || audit.status !== "blocker" || audit.blockedCells.length === 0) return sections;
  const rows = audit.blockedCells
    .map((c) => `${c.period} ${c.rowLabel}`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 8)
    .join("; ");
  const caveat: NarrativeSectionLike = {
    title: "Data Reliability Caveat",
    body:
      `This spread has ${audit.summary.blockers} unresolved accuracy/completion blocker(s). ` +
      `The following lines did not reconcile to source and are unverified: ${rows}. ` +
      `Conclusions touching these rows/periods are preliminary pending corrected source data.`,
  };
  return [caveat, ...sections];
}
