/**
 * SPEC-CREDIT-MEMO-PERFECTION-PROGRAM-1 Phase 1 — decision coherence.
 *
 * Pure helpers that make the memo's recommendation, conditions, and committee
 * eligibility all read the SAME authoritative committee state
 * (committee_readiness). The financial verdict is preserved; when committee is
 * not ready the recommendation carries an explicit caveat and the blockers become
 * conditions-precedent. No DB / IO. Never approves or clears anything.
 */

import type { MemoCommitteeReadinessSection } from "./buildMemoCommitteeReadinessSection";

/** The explicit recommendation caveat when committee readiness is NOT met (else null). */
export function committeeGateCaveat(section: MemoCommitteeReadinessSection | null | undefined): string | null {
  if (!section || section.committee_ready !== false) return null;
  const b = section.remaining_blockers ?? [];
  const n = b.length;
  return (
    `Committee approval is gated — committee readiness is NOT met (${n} blocker${n === 1 ? "" : "s"} remain` +
    `${n ? `: ${b.join("; ")}` : ""}). This recommendation reflects financial analysis only; it is not a ` +
    `committee approval until these are resolved.`
  );
}

/** Prepend the caveat + add committee blockers as exceptions. Returns the input unchanged when ready. */
export function applyCommitteeGateToRecommendation<R extends { rationale: string[]; exceptions: string[] }>(
  rec: R,
  section: MemoCommitteeReadinessSection | null | undefined,
): R {
  const caveat = committeeGateCaveat(section);
  if (!caveat || !section) return rec;
  const blockerList = section.remaining_blockers ?? [];
  return {
    ...rec,
    rationale: [caveat, ...rec.rationale],
    exceptions: [...rec.exceptions, ...blockerList.map((b) => `Committee blocker: ${b}`)],
  };
}

/** Committee blockers rendered as conditions-precedent (empty when ready). */
export function committeeGateConditions(section: MemoCommitteeReadinessSection | null | undefined): string[] {
  if (!section || section.committee_ready !== false) return [];
  return (section.remaining_blockers ?? []).map((b) => `Resolve committee blocker before committee submission: ${b}`);
}

/**
 * One authoritative committee-eligibility verdict. committee_readiness wins when
 * present (the research-gate model the panel renders); fall back to the trust-grade
 * definition only when no committee model exists. Always requires financial readiness.
 */
export function isCommitteeEligible(args: {
  financialReady: boolean;
  trustGrade: string | null;
  evidenceBlockersClear: boolean;
  section: MemoCommitteeReadinessSection | null | undefined;
}): boolean {
  if (!args.financialReady) return false;
  if (args.section) return args.section.committee_ready === true;
  return args.trustGrade === "committee_grade" && args.evidenceBlockersClear;
}
