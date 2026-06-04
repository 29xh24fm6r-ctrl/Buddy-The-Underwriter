/**
 * SPEC-BIE-COMMITTEE-READINESS-FINALIZATION-MEGA-1 — Phase 1
 *
 * Committee Blocker Impact Preview. Shows what WOULD happen if the currently
 * reviewed / accepted / committee-grade evidence were applied against the
 * committee blockers — WITHOUT mutating the gate, tasks, or any state.
 *
 * Pure module — no server-only, no DB, no fabrication. READ-ONLY: it never
 * touches buddy_research_quality_gates, committee tasks, trust_grade,
 * gate_passed, preliminary_eligible, or committee_eligible. It is NOT an
 * approval engine and never auto-clears an unsafe blocker. scale_plausibility is
 * always auto_clear_forbidden. wrong_entity / weak_source / rejected evidence
 * never resolves a blocker.
 */

import type {
  CommitteeBlockerResolution,
  CommitteeBlockerType,
} from "./committeeBlockerResolution";
import type { CommitteeEvidenceTask } from "./committeeEvidenceTasks";
import type { CommitteeRequirementsPlan } from "./committeeRequirementsEngine";

export type ImpactBlockerType =
  | "source_quality"
  | "evidence_coverage"
  | "management_verification"
  | "adverse_screen"
  | "industry_source"
  | "market_source"
  | "competitive_source"
  | "scale_plausibility"
  | "contradiction"
  | "other";

export type ImpactStatus =
  | "would_resolve"
  | "would_reduce"
  | "still_blocked"
  | "not_applicable"
  | "unsafe_to_auto_resolve";

export type CommitteeBlockerImpact = {
  blocker_id: string;
  blocker_label: string;
  blocker_type: ImpactBlockerType;
  current_status: "blocking";
  impact_status: ImpactStatus;
  evidence_applied: Array<{
    task_id?: string;
    source_snapshot_id?: string;
    review_status: string;
    committee_grade_accepted: boolean;
    title: string;
    evidence_basis: string;
  }>;
  why: string;
  remaining_requirements: string[];
  requires_human_conclusion: boolean;
  auto_clear_forbidden: boolean;
};

export type CommitteeBlockerImpactPreview = {
  mission_id: string;
  deal_id: string;
  generated_at: string;
  current_state: {
    trust_grade: string;
    gate_passed: boolean;
    preliminary_eligible: boolean;
    committee_eligible: boolean;
    blocker_count: number;
  };
  accepted_evidence_summary: {
    committee_grade_task_count: number;
    accepted_task_count: number;
    rejected_task_count: number;
    weak_source_task_count: number;
    wrong_entity_task_count: number;
    unreviewed_task_count: number;
  };
  blocker_impacts: CommitteeBlockerImpact[];
  would_reduce_blocker_count: number;
  remaining_blocker_count: number;
  committee_ready_if_applied: boolean;
  committee_ready_blocked_by: string[];
  limitations: string[];
};

export type ImpactPreviewInput = {
  missionId: string;
  dealId: string;
  generatedAt: string;
  gate: {
    trust_grade?: string | null;
    gate_passed?: boolean | null;
    preliminary_eligible?: boolean | null;
    committee_eligible?: boolean | null;
    committee_blockers?: string[] | null;
  } | null;
  resolutions: CommitteeBlockerResolution[];
  requirementsPlan: CommitteeRequirementsPlan | null;
  tasks: CommitteeEvidenceTask[];
};

// ── review-state predicates ───────────────────────────────────────────────────

const isCommitteeGrade = (t: CommitteeEvidenceTask): boolean =>
  t.committee_grade_accepted === true || t.review_status === "committee_grade";
const isAccepted = (t: CommitteeEvidenceTask): boolean => t.review_status === "accepted";
const isBlockingReview = (t: CommitteeEvidenceTask): boolean =>
  t.review_status === "rejected" || t.review_status === "weak_source" || t.review_status === "wrong_entity";

/** Map the resolution's CommitteeBlockerType (+ title) to the impact taxonomy. */
function impactType(r: CommitteeBlockerResolution): ImpactBlockerType {
  const title = (r.title ?? "").toLowerCase();
  switch (r.blocker_type as CommitteeBlockerType) {
    case "source_quality":
    case "public_entity_verification":
      return "source_quality";
    case "evidence_coverage":
    case "financial_file_gap":
    case "collateral_file_gap":
      return "evidence_coverage";
    case "management_verification":
      return "management_verification";
    case "adverse_screen":
      return "adverse_screen";
    case "section_source_gap":
      if (title.includes("industry")) return "industry_source";
      if (title.includes("market")) return "market_source";
      if (title.includes("competitive")) return "competitive_source";
      return "other";
    case "contradiction_gap":
      return /scale/.test(title + (r.blocker_id ?? "")) ? "scale_plausibility" : "contradiction";
    default:
      return "other";
  }
}

const TASK_TYPES_FOR: Record<ImpactBlockerType, string[]> = {
  source_quality: ["borrower_website_snapshot", "sos_business_registry"],
  evidence_coverage: ["financial_file"],
  management_verification: ["management_attestation"],
  adverse_screen: ["public_adverse_screen"],
  industry_source: ["industry_market_source"],
  market_source: ["industry_market_source"],
  competitive_source: ["competitive_source"],
  scale_plausibility: ["financial_file"],
  contradiction: ["manual_review", "financial_file"],
  other: [],
};

function evidenceApplied(tasks: CommitteeEvidenceTask[]) {
  return tasks
    .filter((t) => isCommitteeGrade(t) || isAccepted(t))
    .map((t) => ({
      task_id: t.id,
      source_snapshot_id: t.source_snapshot_id ?? undefined,
      review_status: String(t.review_status ?? "unreviewed"),
      committee_grade_accepted: !!t.committee_grade_accepted,
      title: String(t.title ?? t.task_type ?? "task"),
      evidence_basis: (t.linked_evidence ?? []).map((l) => l.label).slice(0, 3).join(", ") || "loan-file linkage",
    }));
}

/**
 * Evaluate one committee blocker's impact under the current review state.
 * Conservative + safety-first: resolves only with committee-grade (or, where a
 * rule explicitly allows, accepted) evidence; never resolves when any supporting
 * evidence is rejected/weak/wrong-entity; scale_plausibility never resolves.
 */
function evaluateBlocker(r: CommitteeBlockerResolution): CommitteeBlockerImpact {
  const type = impactType(r);
  const allTasks = r.evidence_tasks ?? [];
  const relevant = allTasks.filter((t) => TASK_TYPES_FOR[type].includes(String(t.task_type)));
  const applied = evidenceApplied(relevant);
  const hasBlockingReview = relevant.some(isBlockingReview);
  const cgTasks = relevant.filter(isCommitteeGrade);
  const acceptedTasks = relevant.filter(isAccepted);

  const base = {
    blocker_id: r.blocker_id,
    blocker_label: r.title,
    blocker_type: type,
    current_status: "blocking" as const,
    evidence_applied: applied,
    auto_clear_forbidden: false,
    requires_human_conclusion: false,
  };

  // wrong-entity / weak / rejected supporting evidence can never resolve.
  if (hasBlockingReview) {
    return {
      ...base,
      impact_status: "still_blocked",
      why: "Supporting evidence was rejected / marked weak / wrong-entity — cannot resolve this blocker.",
      remaining_requirements: r.missing_evidence ?? ["Acceptable committee-grade evidence"],
    };
  }

  switch (type) {
    case "scale_plausibility":
      return {
        ...base,
        auto_clear_forbidden: true,
        requires_human_conclusion: true,
        impact_status: applied.length > 0 ? "unsafe_to_auto_resolve" : "still_blocked",
        why: "Scale plausibility is a contradiction check — it never auto-clears and requires an explicit analyst conclusion, even with supporting evidence.",
        remaining_requirements: ["Explicit analyst scale-plausibility conclusion"],
      };

    case "contradiction":
      return {
        ...base,
        requires_human_conclusion: true,
        impact_status: "still_blocked",
        why: "Contradiction checks require an explicit analyst resolution; they do not auto-clear from evidence.",
        remaining_requirements: r.missing_evidence ?? ["Analyst resolution of the contradiction"],
      };

    case "management_verification":
      // Committee verification needs committee_grade (public/attested). Plain
      // accepted supports preliminary only.
      if (cgTasks.length > 0) {
        return { ...base, impact_status: "would_resolve", why: "Committee-grade management verification accepted.", remaining_requirements: [] };
      }
      if (acceptedTasks.length > 0) {
        return {
          ...base,
          impact_status: "would_reduce",
          why: "Management profile accepted for preliminary, but committee requires public/attested (committee-grade) verification.",
          remaining_requirements: ["Public/official or attested committee-grade management verification"],
        };
      }
      return { ...base, impact_status: "still_blocked", why: "No accepted management verification on file.", remaining_requirements: ["Management verification"] };

    case "adverse_screen":
      // Resolves with an accepted screen result OR accepted analyst attestation.
      if (cgTasks.length > 0 || acceptedTasks.length > 0) {
        return { ...base, impact_status: "would_resolve", why: "Public adverse screen / analyst attestation accepted.", remaining_requirements: [] };
      }
      return { ...base, impact_status: "still_blocked", why: "Adverse screen not completed / not accepted.", remaining_requirements: ["Accepted public adverse screen or analyst attestation"] };

    case "industry_source":
    case "market_source":
    case "competitive_source":
      if (cgTasks.length > 0 || acceptedTasks.length > 0) {
        return { ...base, impact_status: "would_resolve", why: "Committee-grade / accepted source attached for this section.", remaining_requirements: [] };
      }
      return { ...base, impact_status: "still_blocked", why: "No accepted committee-grade source attached for this section.", remaining_requirements: r.missing_evidence ?? ["Accepted committee-grade source"] };

    case "source_quality": {
      // Website committee-grade reduces source-quality but cannot alone satisfy
      // all public/institutional source requirements. Resolves only when every
      // source task for the blocker is committee-grade.
      if (relevant.length > 0 && cgTasks.length === relevant.length) {
        return { ...base, impact_status: "would_resolve", why: "All required public/institutional source evidence is committee-grade.", remaining_requirements: [] };
      }
      if (cgTasks.length > 0 || acceptedTasks.length > 0) {
        const missing = relevant.filter((t) => !isCommitteeGrade(t)).map((t) => String(t.title ?? t.task_type));
        return {
          ...base,
          impact_status: "would_reduce",
          why: "Committee-grade source evidence reduces the public/institutional source gap, but stronger official sources are still required.",
          remaining_requirements: missing.length > 0 ? missing : ["Additional primary/institutional public source"],
        };
      }
      return { ...base, impact_status: "still_blocked", why: "No committee-grade public/institutional sources accepted.", remaining_requirements: ["Primary/institutional public source(s)"] };
    }

    case "evidence_coverage": {
      if (cgTasks.length > 0 || acceptedTasks.length > 0) {
        return {
          ...base,
          impact_status: "would_reduce",
          why: "Accepted / committee-grade financial evidence reduces the coverage gap; remaining missing items must still be supplied.",
          remaining_requirements: r.missing_evidence ?? ["Remaining coverage items"],
        };
      }
      return { ...base, impact_status: "still_blocked", why: "Coverage gap not reduced by accepted evidence.", remaining_requirements: r.missing_evidence ?? ["Coverage items"] };
    }

    default:
      return { ...base, impact_status: "still_blocked", why: r.why_it_blocks_committee ?? "Blocker requires resolution.", remaining_requirements: r.missing_evidence ?? [] };
  }
}

export function buildCommitteeBlockerImpactPreview(
  input: ImpactPreviewInput,
): CommitteeBlockerImpactPreview {
  const gate = input.gate ?? {};
  const tasks = input.tasks ?? [];
  const resolutions = input.resolutions ?? [];

  const summary = {
    committee_grade_task_count: tasks.filter(isCommitteeGrade).length,
    accepted_task_count: tasks.filter(isAccepted).length,
    rejected_task_count: tasks.filter((t) => t.review_status === "rejected").length,
    weak_source_task_count: tasks.filter((t) => t.review_status === "weak_source").length,
    wrong_entity_task_count: tasks.filter((t) => t.review_status === "wrong_entity").length,
    unreviewed_task_count: tasks.filter((t) => !t.review_status || t.review_status === "unreviewed").length,
  };

  const blocker_impacts = resolutions.map(evaluateBlocker);
  const would_reduce_blocker_count = blocker_impacts.filter((b) => b.impact_status === "would_resolve").length;
  const blocker_count = (gate.committee_blockers ?? []).length || resolutions.length;
  const remaining_blocker_count = Math.max(0, blocker_count - would_reduce_blocker_count);

  // committee_ready only if EVERY blocker would_resolve (no still_blocked,
  // unsafe_to_auto_resolve, would_reduce, or human-conclusion items remain).
  const committee_ready_blocked_by = blocker_impacts
    .filter((b) => b.impact_status !== "would_resolve")
    .map((b) => b.blocker_label);
  const committee_ready_if_applied =
    resolutions.length > 0 && committee_ready_blocked_by.length === 0;

  return {
    mission_id: input.missionId,
    deal_id: input.dealId,
    generated_at: input.generatedAt,
    current_state: {
      trust_grade: String(gate.trust_grade ?? "unknown"),
      gate_passed: gate.gate_passed === true,
      preliminary_eligible: gate.preliminary_eligible === true,
      committee_eligible: gate.committee_eligible === true,
      blocker_count,
    },
    accepted_evidence_summary: summary,
    blocker_impacts,
    would_reduce_blocker_count,
    remaining_blocker_count,
    committee_ready_if_applied,
    committee_ready_blocked_by,
    limitations: [
      "Read-only preview — no gate, task, or trust-grade state is changed.",
      "Not an approval: committee readiness still requires operator review and any human-conclusion items (e.g. scale plausibility).",
      "Unreviewed source snapshots are not treated as committee-grade.",
    ],
  };
}
