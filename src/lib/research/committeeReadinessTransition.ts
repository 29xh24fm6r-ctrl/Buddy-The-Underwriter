/**
 * SPEC-BIE-COMMITTEE-READINESS-FINALIZATION-MEGA-1 — Phase 2
 *
 * Committee Readiness Transition Guard. Deterministic, PREVIEW-ONLY computation
 * of whether committee readiness would be eligible to transition after the
 * currently reviewed evidence is applied. It does NOT flip committee_eligible
 * and performs NO mutation — it only reports eligibility + the operator actions
 * still required.
 *
 * Pure module. Safety rules (never weakened):
 *  - wrong-entity / conflicting-entity always prevents transition;
 *  - rejected / weak / wrong-entity supporting evidence prevents resolution;
 *  - unreviewed evidence and missing tasks cannot satisfy committee;
 *  - committee_grade_accepted satisfies applicable source/verification reqs;
 *  - accepted-only satisfies only where analyst acceptance is explicitly allowed
 *    (adverse screen, competitive/industry/market source attach);
 *  - scale_plausibility requires an analyst conclusion (never auto-resolves);
 *  - transition requires ALL committee blockers resolved (no waiver system here).
 */

import type {
  CommitteeBlockerImpact,
  CommitteeBlockerImpactPreview,
} from "./committeeBlockerImpactPreview";
import type { CommitteeEvidenceTask } from "./committeeEvidenceTasks";

export type ProposedTrustGrade =
  | "manual_review_required"
  | "preliminary"
  | "banker_certified_preliminary"
  | "committee_grade";

export type CommitteeReadinessTransitionResult = {
  eligible_for_committee_transition: boolean;
  current_committee_eligible: boolean;
  proposed_committee_eligible: boolean;
  proposed_trust_grade: ProposedTrustGrade;
  resolved_blockers: string[];
  remaining_blockers: string[];
  hard_blockers: string[];
  unsafe_to_auto_resolve: string[];
  required_operator_actions: string[];
  explanation: string;
};

export type TransitionInput = {
  preview: CommitteeBlockerImpactPreview;
  gate: {
    trust_grade?: string | null;
    preliminary_eligible?: boolean | null;
    committee_eligible?: boolean | null;
    committee_blockers?: string[] | null;
  } | null;
  tasks: CommitteeEvidenceTask[];
};

function currentProposedGrade(gate: TransitionInput["gate"]): ProposedTrustGrade {
  const tg = String(gate?.trust_grade ?? "");
  if (tg === "committee_grade") return "committee_grade";
  if (tg === "banker_certified_preliminary") return "banker_certified_preliminary";
  if (gate?.preliminary_eligible === true || tg === "preliminary") return "preliminary";
  return "manual_review_required";
}

export function evaluateCommitteeReadinessTransition(
  input: TransitionInput,
): CommitteeReadinessTransitionResult {
  const { preview, gate } = input;
  const tasks = input.tasks ?? [];
  const impacts = preview.blocker_impacts ?? [];

  const resolved = impacts.filter((b) => b.impact_status === "would_resolve");
  const remaining = impacts.filter((b) => b.impact_status !== "would_resolve");
  const unsafe = impacts.filter((b) => b.impact_status === "unsafe_to_auto_resolve" || b.auto_clear_forbidden);
  const humanConclusion = impacts.filter((b) => b.requires_human_conclusion);

  // Wrong-entity / conflicting-entity is an absolute hard stop.
  const wrongEntityPresent =
    tasks.some((t) => t.review_status === "wrong_entity") ||
    impacts.some((b) => /wrong|conflicting/i.test(b.blocker_label + " " + b.why));

  const hard_blockers = Array.from(
    new Set([
      ...(wrongEntityPresent ? remaining.filter((b) => /wrong|conflicting/i.test(b.blocker_label + " " + b.why)).map((b) => b.blocker_label) : []),
      ...unsafe.map((b) => b.blocker_label),
      ...humanConclusion.map((b) => b.blocker_label),
    ]),
  );

  const eligible_for_committee_transition =
    !wrongEntityPresent &&
    impacts.length > 0 &&
    remaining.length === 0 && // every blocker would_resolve
    unsafe.length === 0 &&
    humanConclusion.length === 0;

  const required_operator_actions: string[] = [];
  if (!eligible_for_committee_transition) {
    if (wrongEntityPresent) {
      required_operator_actions.push("Resolve wrong/conflicting entity before any committee transition (cannot be waived).");
    }
    for (const b of remaining) {
      for (const req of b.remaining_requirements) required_operator_actions.push(`${b.blocker_label}: ${req}`);
    }
    if (humanConclusion.length > 0) {
      required_operator_actions.push("Record the required analyst conclusion(s) (e.g. scale plausibility).");
    }
    required_operator_actions.push("Operator review required before committee readiness transition.");
  }

  const proposed_trust_grade: ProposedTrustGrade = eligible_for_committee_transition
    ? "committee_grade"
    : currentProposedGrade(gate);

  const explanation = eligible_for_committee_transition
    ? "All committee blockers would be resolved by accepted / committee-grade evidence. Committee readiness transition eligible after operator review (not an approval)."
    : `Committee readiness transition not eligible: ${remaining.length} blocker(s) remain` +
      (wrongEntityPresent ? ", including an unresolved wrong/conflicting entity (hard stop)" : "") +
      (humanConclusion.length > 0 ? ", and analyst-conclusion item(s) remain" : "") +
      ". Preliminary status is unchanged.";

  return {
    eligible_for_committee_transition,
    current_committee_eligible: gate?.committee_eligible === true,
    // PREVIEW-ONLY: proposed value is never written to the gate in this layer.
    proposed_committee_eligible: eligible_for_committee_transition,
    proposed_trust_grade,
    resolved_blockers: resolved.map((b) => b.blocker_label),
    remaining_blockers: remaining.map((b) => b.blocker_label),
    hard_blockers,
    unsafe_to_auto_resolve: unsafe.map((b) => b.blocker_label),
    required_operator_actions: Array.from(new Set(required_operator_actions)),
    explanation,
  };
}

// ── Phase 3: committee readiness section (final packet / payload shape) ───────

export type CommitteeReadinessSection = {
  preliminary_status: { ready: boolean; basis: string };
  committee_status: {
    ready: boolean;
    eligible_for_transition: boolean;
    trust_grade: string;
    remaining_blocker_count: number;
  };
  accepted_evidence: Array<{
    title: string;
    review_status: string;
    committee_grade_accepted: boolean;
    source_type?: string;
    section?: string;
  }>;
  resolved_or_reduced_blockers: CommitteeBlockerImpact[];
  remaining_blockers: CommitteeBlockerImpact[];
  required_next_actions: string[];
  limitations: string[];
};

/**
 * Assemble the committee-readiness section for the research/committee packet.
 * Pure. Never implies approval; "eligible_for_transition" means eligible AFTER
 * operator review, not approved. Only accepted / committee-grade evidence is
 * listed as accepted_evidence (never unreviewed).
 */
export function buildCommitteeReadinessSection(
  preview: CommitteeBlockerImpactPreview,
  transition: CommitteeReadinessTransitionResult,
  tasks: CommitteeEvidenceTask[],
): CommitteeReadinessSection {
  const accepted_evidence = (tasks ?? [])
    .filter((t) => t.committee_grade_accepted === true || t.review_status === "accepted" || t.review_status === "committee_grade")
    .map((t) => ({
      title: String(t.title ?? t.task_type ?? "task"),
      review_status: String(t.review_status ?? "unreviewed"),
      committee_grade_accepted: !!t.committee_grade_accepted,
      source_type: t.task_type ? String(t.task_type) : undefined,
      section: (t.linked_sections ?? [])[0],
    }));

  const resolved_or_reduced_blockers = preview.blocker_impacts.filter(
    (b) => b.impact_status === "would_resolve" || b.impact_status === "would_reduce",
  );
  const remaining_blockers = preview.blocker_impacts.filter(
    (b) => b.impact_status === "still_blocked" || b.impact_status === "unsafe_to_auto_resolve",
  );

  return {
    preliminary_status: {
      ready: preview.current_state.preliminary_eligible,
      basis: preview.current_state.preliminary_eligible
        ? "Preliminary cleared (file / banker-certified evidence)."
        : "Preliminary not yet cleared.",
    },
    committee_status: {
      ready: preview.current_state.committee_eligible,
      eligible_for_transition: transition.eligible_for_committee_transition,
      trust_grade: preview.current_state.trust_grade,
      remaining_blocker_count: preview.remaining_blocker_count,
    },
    accepted_evidence,
    resolved_or_reduced_blockers,
    remaining_blockers,
    required_next_actions: transition.required_operator_actions,
    limitations: preview.limitations,
  };
}

// ── Phase 4: disabled-by-default operator transition stub ─────────────────────
/**
 * NOT IMPLEMENTED / DISABLED. Placeholder for a future operator-approved gate
 * transition. It is intentionally unreachable from any route or UI and always
 * throws unless an explicit (not-yet-existing) enable flag is passed. No DB
 * mutation is performed here. Pinned as disabled by tests.
 */
export function applyCommitteeReadinessTransition(_opts?: {
  enableExplicitlyForTesting?: boolean;
}): never {
  throw new Error(
    "applyCommitteeReadinessTransition is disabled — committee gate transition is not implemented in this phase and must never run automatically.",
  );
}
