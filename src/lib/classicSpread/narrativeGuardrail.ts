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
  if (audit.status === "blocker") {
    // SPEC-CLASSIC-SPREAD-V7-FOLLOWUP-1 #3: under a BLOCKER, forbid unqualified positive conclusions.
    lines.push(
      "BLOCKER CLAMP: This spread is NOT reliable for credit decisioning until reconciled. Do NOT use " +
        'phrases like "strong", "favorable trends", "supports", "adequacy/adequate", "resilience", ' +
        '"robust", "healthy", or "solid" unless immediately caveated as unverified. Prefer "reported", ' +
        '"preliminary", "unverified", and state results are "not reliable for credit decisioning until ' +
        'reconciled."',
    );
  }
  return lines;
}

// SPEC-CLASSIC-SPREAD-V7-FOLLOWUP-1 #3: strong-positive conclusion vocabulary that must not stand
// unqualified while a blocker is open.
const STRONG_POSITIVE = /\b(strong(?:ly)?|favorabl[ey]|support(?:s|ed|ing)?|adequa(?:te|cy)|resilien(?:t|ce)|robust|healthy|solid|well[- ]positioned)\b/gi;

const BLOCKER_DISCLAIMER =
  "These figures are reported and preliminary; under unresolved accuracy blockers they are " +
  "unverified and not reliable for credit decisioning until reconciled.";

/**
 * Under a BLOCKER audit, neutralize unqualified strong-positive conclusions in each model-generated
 * section: tag every strong-positive term as "(unverified)" and append a conservative disclaimer so
 * no section reads as a confident endorsement. Pure; returns a new array.
 */
export function clampBlockerConclusions<T extends NarrativeSectionLike>(
  sections: T[],
  audit: SpreadAuditResult | null | undefined,
): T[] {
  if (!audit || audit.status !== "blocker") return sections;
  return sections.map((s) => {
    let body = s.body.replace(STRONG_POSITIVE, (m) => `${m} (unverified)`);
    if (!/not reliable for credit decisioning until reconciled/i.test(body)) {
      body = body.trim().length > 0 ? `${body.trim()} ${BLOCKER_DISCLAIMER}` : BLOCKER_DISCLAIMER;
    }
    return { ...s, body };
  });
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
