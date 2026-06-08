/**
 * SPEC-BIE-COMMITTEE-READINESS-UX-SIMPLIFICATION-1
 *
 * Pure, deterministic view-model that turns the machine-shaped committee
 * readiness data (blocker resolutions + impact preview/transition section +
 * requirements plan) into a banker-facing surface:
 *
 *   1. Where we stand   → summary status + 3 counters
 *   2. What is good      → "already on file" per group
 *   3. What still blocks  → 5 human-readable evidence groups + status
 *   4. What to do next    → one prioritized "next best action"
 *   5. Why it matters     → plain-English group explanations
 *
 * This module is UI/copy/organization ONLY. It reads the already-computed
 * snapshot and re-projects it; it NEVER changes gate scoring, eligibility,
 * evidence-task logic, or any persisted state, and performs no I/O. Implementation
 * words (source_quality, evidence_coverage, resolved_status, committee_grade_accepted,
 * auto_clear_forbidden, task_type, blocker_type, section_source_gap, contradiction_gap)
 * are confined to the audit projection — never the default banker view.
 *
 * No React / DOM / server imports — unit-testable without rendering.
 */

import type { ResearchGateSnapshot } from "./researchGateTypes";
import type { CommitteeBlockerResolution } from "@/lib/research/committeeBlockerResolution";
import type { CommitteeEvidenceTask } from "@/lib/research/committeeEvidenceTasks";
import type { CommitteeBlockerImpact } from "@/lib/research/committeeBlockerImpactPreview";
import { buildDecisionNarrative, type InstitutionalDecisionNarrative } from "./institutionalDecisionNarratives";

// ── Public view-model types ──────────────────────────────────────────────────

/** Banker-facing status of a single item or group. */
export type BankerStatus = "complete" | "needs_review" | "missing" | "needs_analyst_conclusion";

export type GroupStatusLabel = "Complete" | "Needs review" | "Missing" | "Needs analyst conclusion";

export type CommitteeReadinessGroupId =
  | "entity"
  | "management"
  | "financial"
  | "industry"
  | "risk"
  | "scale";

export interface CommitteeReadinessGroupView {
  id: CommitteeReadinessGroupId;
  title: string;
  status: GroupStatusLabel;
  /** Plain-English "why this matters" for the group. */
  explanation: string;
  /** Evidence already accepted as committee-grade / supported, in banker language. */
  alreadyOnFile: string[];
  /** SPEC-…-STATE-CORRECTNESS-1: captured / accepted-for-preliminary items that
   *  still need committee-grade review (NOT "still needed"). */
  needsReview: string[];
  /** Truly absent items committee still needs. */
  missing: string[];
  /** One concrete state-aware next action for this group (null when complete). */
  nextAction: string | null;
  /**
   * SPEC-…-OFFICIAL-PDF-CAPTURE-1: durable captured-source artifacts, split into
   * the ACTUAL official capture (when available) and Buddy's generated receipt —
   * never conflated. `officialCaptureUrl` is null unless a usable official capture
   * exists; `officialCaptureStatus` explains why (e.g. search_form_only).
   */
  capturedSources: {
    label: string;
    officialCaptureUrl: string | null;
    officialCaptureStatus: string;
    receiptUrl: string;
    htmlReceiptUrl: string;
  }[];
  /**
   * SPEC-BIE-COMMITTEE-READINESS-FINAL-UX-POLISH-AND-PDF-ARTIFACTS-1 Phase 1:
   * needs-review tasks that are directly actionable in the default card (mark
   * committee-grade / reject / etc.), so review controls are not buried under
   * "Show audit details".
   */
  reviewableTasks: CommitteeEvidenceTask[];
  /**
   * SPEC-…-ACTION-CENTER-1 Phase 3: still-missing tasks (with ids) that need a
   * type-aware capture/record action (never Accept/Committee-grade). Rendered with
   * deriveTaskActions so the card shows the right primary (e.g. "Record
   * adverse-screen result", "Capture official result page").
   */
  missingActionableTasks: CommitteeEvidenceTask[];
}

export interface CommitteeReadinessSummaryView {
  /** "Preliminary is clear" / "Preliminary is not clear yet". */
  preliminaryStatusLabel: string;
  /** "Committee is ready" / "Committee is not ready yet". */
  committeeStatusLabel: string;
  preliminaryClear: boolean;
  committeeReady: boolean;
  subcopy: string;
  counters: { ready: number; needsReview: number; missing: number };
  /** Single prioritized action, e.g. "Complete the adverse-record screen". */
  nextBestAction: string | null;
}

export interface ScalePlausibilityView {
  label: string;
  explanation: string;
  nextAction: string;
}

/** SPEC-…-UX-REDESIGN-1: the compact top readiness hero. */
export interface ReadinessHeroView {
  /** "Preliminary clear · Committee not ready". */
  statusLine: string;
  /** One short banker sentence. */
  explanation: string;
  progress: { ready: number; needsReview: number; missing: number };
  /** The single top next action (queue[0]), or null when committee-ready. */
  primaryActionLabel: string | null;
  /** SPEC-…-FINAL-WORKFLOW-CORRECTION-1: number of executable Next Action cards
   *  (reconciles 1:1 with committeeBlockers). */
  actionsRequired: number;
}

/** SPEC-…-UX-REDESIGN-1: one exact committee blocker (shown once). */
export interface CommitteeBlockerLine {
  label: string;
  groupId: CommitteeReadinessGroupId;
  status: GroupStatusLabel;
}

/**
 * SPEC-COMMITTEE-ACTION-CENTER-FINAL-WORKFLOW-CORRECTION-1: the canonical
 * executable work item — ONE per unresolved group, in priority order. The Next
 * Actions section renders a resolution card per item; Committee Blockers + the
 * hero count reconcile 1:1 with this list. `task` is the evidence task the card
 * resolves (null when a group has an unresolved blocker but no actionable task).
 */
export interface CommitteeActionCard {
  id: string;
  /** The action to take, state-aware (e.g. "Record the public adverse-record screen result."). */
  title: string;
  why: string;
  groupId: CommitteeReadinessGroupId;
  status: GroupStatusLabel;
  task: CommitteeEvidenceTask | null;
  /** SPEC-BIE-COMMITTEE-DECISION-INTELLIGENCE-1: institutional decision support. */
  support: DecisionSupport;
  /** SPEC-BIE-INSTITUTIONAL-DECISION-NARRATIVES-1: conclusion + recommendation. */
  narrative: InstitutionalDecisionNarrative;
}

/** One scale-plausibility input the analyst conclusion must reconcile. */
export interface ScaleChecklistItem {
  label: string;
  present: boolean;
}

/** A captured source link for a decision card (official capture vs Buddy receipt). */
export interface DecisionSourceLink {
  label: string;
  url: string;
  official: boolean;
}

/**
 * SPEC-BIE-COMMITTEE-DECISION-INTELLIGENCE-1: everything a banker needs to make
 * one committee decision, projected from existing BIE data (blocker resolutions,
 * requirements plan, evidence tasks, captured sources). No new facts/IO.
 */
export interface DecisionSupport {
  decisionReason: string;
  evidenceFound: string[];
  evidenceMissing: string[];
  acceptableEvidence: string[];
  bankerGuidance: string;
  sourceLinks: DecisionSourceLink[];
  sourceLimitations: string[];
  /** Scale-plausibility group only. */
  scaleChecklist: ScaleChecklistItem[];
  /** True when there is captured evidence to approve; false → "add support / request more". */
  enoughToApprove: boolean;
}

/** SPEC-…-ACTION-CENTER-1: one item in the prioritized "Next actions" queue. */
export interface NextActionItem {
  id: string;
  /** The primary action, plain banker English. */
  label: string;
  /** Why it matters for committee. */
  why: string;
  status: GroupStatusLabel;
  groupId: CommitteeReadinessGroupId;
}

/**
 * SPEC-…-ACTION-CENTER-1 Phase 3: pure button-presentation plan for one task.
 * Uses the existing validated review actions; only the PRESENTATION changes.
 */
export type TaskPrimaryKind =
  | "mark_committee_grade"
  | "capture_official"
  | "attach_evidence"
  | "record_result"
  | "add_conclusion"
  | "add_loan_request"
  | "request_more";

export interface TaskActionPlan {
  primaryLabel: string;
  primaryKind: TaskPrimaryKind;
  /** Show the Accept button (collected/needs-review, not committee-grade yet). */
  showAccept: boolean;
  /** Show the Committee-grade button at all (hidden for missing/scale). */
  showCommitteeGrade: boolean;
  /** Committee-grade shown but disabled (e.g. SOS search-form-only, financial gaps). */
  committeeGradeDisabled: boolean;
  committeeGradeBlockedReason: string | null;
  /** A short provenance/limitation note for the card. */
  note: string | null;
}

export interface CommitteeReadinessAuditTaskRow {
  task_type: string;
  resolved_status: string;
  review_status: string;
  committee_grade_accepted: boolean;
  auto_clear_forbidden: boolean;
  linked_evidence_count: number;
  artifact_view_url: string | null;
}

export interface CommitteeReadinessAuditRow {
  blocker_id: string;
  blocker_type: string;
  resolved_status: string;
  impact_status: string | null;
  linked_evidence_count: number;
  tasks: CommitteeReadinessAuditTaskRow[];
}

export interface CommitteeReadinessView {
  summary: CommitteeReadinessSummaryView;
  /** SPEC-…-UX-REDESIGN-1: compact top readiness hero. */
  hero: ReadinessHeroView;
  /** SPEC-…-FINAL-WORKFLOW-CORRECTION-1: canonical executable Next Action cards. */
  actionCards: CommitteeActionCard[];
  /** SPEC-…-ACTION-CENTER-1: label projection of actionCards (same order/count). */
  nextActions: NextActionItem[];
  /** The group of the top next action — the only card expanded by default. */
  defaultExpandedGroupId: CommitteeReadinessGroupId | null;
  groups: CommitteeReadinessGroupView[];
  /** SPEC-…-UX-REDESIGN-1: exact committee blockers, deduped, shown once. */
  committeeBlockers: CommitteeBlockerLine[];
  /** SPEC-…-INSTITUTIONAL-DECISION-NARRATIVES-1: narrative per group (all groups). */
  decisionNarratives: Record<string, InstitutionalDecisionNarrative>;
  scalePlausibility: ScalePlausibilityView | null;
  audit: CommitteeReadinessAuditRow[];
}

// ── Static banker copy ───────────────────────────────────────────────────────

const GROUP_ORDER: CommitteeReadinessGroupId[] = [
  "entity",
  "management",
  "financial",
  "industry",
  "risk",
  "scale",
];

// SPEC-…-POLISH-1 (C): banker-readable group names — used by the progress rail,
// the action cards, and the blocker bullets.
const GROUP_TITLE: Record<CommitteeReadinessGroupId, string> = {
  entity: "Public records",
  management: "Management support",
  financial: "Financial support",
  industry: "Industry validation",
  risk: "Public screening",
  scale: "Analyst conclusion",
};

// Short banker subtext shown under each action card.
const GROUP_EXPLANATION: Record<CommitteeReadinessGroupId, string> = {
  entity: "Official public/entity record required for committee.",
  management: "Management background support required.",
  financial: "Loan request and repayment support required.",
  industry: "Outside market validation required.",
  risk: "Public-screen result required before committee review.",
  scale: "Analyst sign-off required.",
};

// Per-group next action keyed by the group's worst remaining status. Curated so
// the default view never surfaces raw recommended_actions that may carry machine
// vocabulary.
const GROUP_NEXT_ACTION: Record<
  CommitteeReadinessGroupId,
  Partial<Record<BankerStatus, string>>
> = {
  entity: {
    missing: "Add a Secretary of State or business-registry record for the borrower.",
    needs_review:
      "Review the registry and website records and mark them committee-grade, or reject them.",
    needs_analyst_conclusion:
      "Review the registry and website records and mark them committee-grade, or reject them.",
  },
  management: {
    missing: "Attach management/ownership attestation and run a public adverse screen.",
    needs_review: "Attach or accept the management/ownership attestation.",
    needs_analyst_conclusion: "Attach or accept the management/ownership attestation.",
  },
  financial: {
    missing:
      "Attach the loan request, use-of-proceeds, and supporting financial/collateral evidence.",
    needs_review: "Tie the loan request and repayment support to the financials.",
    needs_analyst_conclusion: "Tie the loan request and repayment support to the financials.",
  },
  industry: {
    missing: "Add industry, market, and competitor sources.",
    needs_review: "Confirm the industry, market, and competitor sources are committee-grade.",
    needs_analyst_conclusion:
      "Confirm the industry, market, and competitor sources are committee-grade.",
  },
  risk: {
    missing: "Record the public adverse-record screen result.",
    needs_review: "Review the adverse-record screen result and mark it committee-grade.",
    needs_analyst_conclusion: "Record the public adverse-record screen result.",
  },
  scale: {
    missing: "Add an analyst conclusion for scale plausibility.",
    needs_review: "Add an analyst conclusion for scale plausibility.",
    needs_analyst_conclusion: "Add an analyst conclusion for scale plausibility.",
  },
};

const SCALE_PLAUSIBILITY: ScalePlausibilityView = {
  label: "Scale plausibility needs analyst conclusion",
  explanation:
    "Buddy found enough evidence to continue preliminary underwriting, but committee needs an analyst to confirm that the borrower's revenue, working-capital request, customer growth story, staffing/capacity, and collateral support are consistent.",
  nextAction: "Add an analyst conclusion with supporting evidence.",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip implementation underscores from any data-derived string. */
function scrub(s: string): string {
  return String(s ?? "").replace(/_/g, " ").trim();
}

function taskResolvedStatus(t: CommitteeEvidenceTask): string {
  return String(t.resolved_status ?? t.status ?? "pending");
}

function isScaleBlocker(r: CommitteeBlockerResolution, impact?: CommitteeBlockerImpact): boolean {
  if (impact?.blocker_type === "scale_plausibility") return true;
  return /scale plausibilit/i.test(r.title ?? "");
}

function isAdverseScreenBlocker(r: CommitteeBlockerResolution): boolean {
  return r.blocker_type === "adverse_screen" || /adverse screen/i.test(r.title ?? "");
}

// Only committee-grade or an explicit banker attestation fully resolves a blocker
// in the VIEW. "accepted" (preliminary) is NOT here — the impact engine already
// promotes "accepted" to would_resolve for the blockers where that applies
// (adverse/industry); treating it as a blanket resolve would wrongly clear
// management/source-quality, which need committee-grade.
const RESOLVING_REVIEW = new Set(["committee_grade", "banker_attested"]);
const BLOCKING_REVIEW = new Set(["rejected", "wrong_entity", "weak_source"]);

/**
 * SPEC-…-WORKFLOW-RESOLUTION-1: a blocker is resolved by IN-PLACE banker review
 * when it has actionable tasks and every one is in a resolving review state
 * (committee-grade / accepted / banker-attested) with none in a blocking state.
 * This is committee-readiness VIEW derivation only — it never touches the gate,
 * scoring, eligibility, or the impact engine. It is what lets a recorded
 * screening result, an analyst scale conclusion, or a banker override move a
 * blocker to Complete on the next read.
 */
function blockerResolvedByReview(r: CommitteeBlockerResolution): boolean {
  const tasks = (r.evidence_tasks ?? []).filter((t) => !!t.id);
  if (tasks.length === 0) return false;
  if (tasks.some((t) => BLOCKING_REVIEW.has(String(t.review_status ?? "")))) return false;
  return tasks.every(
    (t) => RESOLVING_REVIEW.has(String(t.review_status ?? "")) || !!t.committee_grade_accepted,
  );
}

/**
 * Classify one blocker into the banker status taxonomy.
 *
 * Driven primarily by the resolution's own `current_status` so the banker view
 * matches how committee actually reads it:
 *   - resolved / would_resolve            → Complete
 *   - contradiction / scale (human needed) → Needs analyst conclusion
 *   - present_but_not_committee_grade      → Needs review (captured, mark/accept)
 *   - partial (a required item still absent) / missing → Missing
 */
function classifyBlocker(
  r: CommitteeBlockerResolution,
  impact: CommitteeBlockerImpact | undefined,
): BankerStatus {
  if (impact?.impact_status === "would_resolve" || r.current_status === "resolved") {
    return "complete";
  }
  // In-place banker resolution (screening result / analyst conclusion / override)
  // moves the blocker to Complete even for scale/contradiction, which the impact
  // engine deliberately never auto-resolves.
  if (blockerResolvedByReview(r)) return "complete";
  // Scale plausibility / contradictions never auto-clear — analyst must conclude.
  const needsConclusion =
    impact?.requires_human_conclusion === true ||
    impact?.auto_clear_forbidden === true ||
    r.blocker_type === "contradiction_gap" ||
    isScaleBlocker(r, impact);
  if (needsConclusion) return "needs_analyst_conclusion";

  // Evidence captured but not yet committee-grade → reviewable.
  if (r.current_status === "present_but_not_committee_grade") return "needs_review";
  // partial = some evidence on file but a required item is still absent → missing.
  return "missing";
}

function bucketFor(
  r: CommitteeBlockerResolution,
  impact: CommitteeBlockerImpact | undefined,
): CommitteeReadinessGroupId {
  const t = (r.title ?? "").toLowerCase();
  // SPEC-…-UX-REDESIGN-1: scale plausibility is its own evidence group.
  if (isScaleBlocker(r, impact)) return "scale";
  switch (r.blocker_type) {
    case "adverse_screen":
      return "risk";
    case "contradiction_gap":
      return "risk";
    case "management_verification":
      return "management";
    case "evidence_coverage":
    case "financial_file_gap":
    case "collateral_file_gap":
      return "financial";
    case "public_entity_verification":
    case "source_quality":
      return "entity";
    case "section_source_gap":
      return "industry";
    default:
      break;
  }
  // "other" + fallbacks: route by impact taxonomy / title keywords.
  if (impact?.blocker_type === "contradiction") return "risk";
  if (impact?.blocker_type === "management_verification") return "management";
  if (impact?.blocker_type === "evidence_coverage") return "financial";
  if (/industry|market|competit/.test(t)) return "industry";
  if (/management|ownership/.test(t)) return "management";
  if (/loan request|use of proceeds|collateral|financial|dscr/.test(t)) return "financial";
  return "entity"; // wrong/conflicting entity + unknowns are an identity concern.
}

const STATUS_RANK: Record<BankerStatus, number> = {
  missing: 4,
  needs_analyst_conclusion: 3,
  needs_review: 2,
  complete: 1,
};

const STATUS_LABEL: Record<BankerStatus, GroupStatusLabel> = {
  missing: "Missing",
  needs_analyst_conclusion: "Needs analyst conclusion",
  needs_review: "Needs review",
  complete: "Complete",
};

type ItemBucket = "onFile" | "needsReview" | "missing";

/**
 * SPEC-BIE-COMMITTEE-READINESS-STATE-CORRECTNESS-1: classify a single evidence
 * task into the correct bucket + banker label using ACTUAL review/collection
 * state. Collected/accepted/committee-grade items never land in "missing".
 */
function classifyTaskItem(t: CommitteeEvidenceTask): { bucket: ItemBucket; label: string } {
  const title = scrub(String(t.title ?? t.task_type ?? "evidence"));
  const resolved = taskResolvedStatus(t);
  if (t.review_status === "committee_grade" || t.committee_grade_accepted) {
    return { bucket: "onFile", label: `${title} — accepted for committee` };
  }
  // SPEC-…-WORKFLOW-RESOLUTION-1: a banker-attested resolution (screening result,
  // analyst conclusion, override) is on file — never "missing".
  if (t.review_status === "banker_attested") {
    return { bucket: "onFile", label: `${title} — resolved by banker (attested)` };
  }
  if (t.review_status === "rejected" || t.review_status === "weak_source" || t.review_status === "wrong_entity") {
    return { bucket: "missing", label: `${title} — re-collect (${scrub(t.review_status)})` };
  }
  if (t.review_status === "accepted" || resolved === "accepted") {
    return { bucket: "needsReview", label: `${title} — accepted for preliminary; committee review still needed` };
  }
  if (resolved === "collected" || resolved === "needs_review") {
    return { bucket: "needsReview", label: `${title} — captured, needs review` };
  }
  return { bucket: "missing", label: `${title} — missing` };
}

/** Classify one coverage-checklist item by its file-derived status. */
function classifyChecklistItem(label: string, status: string): { bucket: ItemBucket; label: string } {
  const t = scrub(label);
  if (status === "collected") return { bucket: "onFile", label: `${t} — on file` };
  if (status === "needs_review") return { bucket: "needsReview", label: `${t} — captured, needs review` };
  return { bucket: "missing", label: `${t} — missing` };
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// ── Prioritized "next best action" ───────────────────────────────────────────
// Deterministic scan, in the spec's priority order. Returns the first action
// whose rule matches any blocker.

type RankedBlocker = {
  r: CommitteeBlockerResolution;
  impact?: CommitteeBlockerImpact;
  status: BankerStatus;
};

function hasRejectedOrWrongEntityEvidence(r: CommitteeBlockerResolution): boolean {
  return (r.evidence_tasks ?? []).some(
    (t) => t.review_status === "wrong_entity" || t.review_status === "rejected",
  );
}

function mentionsLoanRequest(r: CommitteeBlockerResolution): boolean {
  const hay = (
    r.why_it_blocks_committee +
    " " +
    (r.missing_evidence ?? []).join(" ")
  ).toLowerCase();
  return /loan request|use of proceeds/.test(hay);
}

// Prioritized next-action rules (module-scope so both the single next-best-action
// and the action-center queue share one source of truth + ordering). Adverse
// screen is rule #2 → the top action for a deal whose only-missing risk item is
// the adverse screen (the OmniCare case).
const NEXT_ACTION_RULES: Array<{
  match: (b: RankedBlocker) => boolean;
  action: string;
  why: string;
}> = [
  {
    match: (b) =>
      /wrong\/conflicting|conflicting public entity/i.test(b.r.title ?? "") ||
      hasRejectedOrWrongEntityEvidence(b.r),
    action: "Resolve the wrong or conflicting borrower entity before committee review.",
    why: "Committee cannot rely on evidence tied to the wrong or a conflicting entity.",
  },
  {
    match: (b) => isAdverseScreenBlocker(b.r) && b.status !== "complete",
    action: "Complete the adverse-record screen.",
    why: "Committee requires a documented public adverse-record screen result.",
  },
  {
    match: (b) =>
      bucketFor(b.r, b.impact) === "financial" && mentionsLoanRequest(b.r) && b.status !== "complete",
    action: "Add loan request and use-of-proceeds support.",
    why: "Committee needs the loan request and use of proceeds tied to the financials.",
  },
  {
    match: (b) =>
      (b.r.blocker_type === "public_entity_verification" || b.r.blocker_type === "source_quality") &&
      b.status === "needs_review",
    action: "Review the Secretary of State record and mark it committee-grade, or reject it.",
    why: "An official entity record is captured but not yet reviewed to committee-grade.",
  },
  {
    match: (b) => b.r.blocker_type === "management_verification" && b.status === "needs_review",
    action: "Attach or accept the management/ownership attestation.",
    why: "Management/ownership needs reviewed or attested evidence for committee.",
  },
  {
    match: (b) =>
      bucketFor(b.r, b.impact) === "industry" &&
      /industry|market/i.test(b.r.title ?? "") &&
      !/competit/i.test(b.r.title ?? "") &&
      b.status === "missing",
    action: "Add an industry or market source.",
    why: "Committee needs an outside industry/market source for the sector claims.",
  },
  {
    match: (b) => /competit/i.test(b.r.title ?? "") && b.status !== "complete",
    action: "Add committee-grade competitor support.",
    why: "Competitor claims need an outside source committee can rely on.",
  },
  {
    match: (b) => isScaleBlocker(b.r, b.impact) && b.status !== "complete",
    action: "Add an analyst conclusion for scale plausibility.",
    why: "Scale plausibility never auto-clears — it needs an explicit analyst conclusion.",
  },
];

/**
 * SPEC-…-ACTION-CENTER-1: the prioritized guided queue. One item per matched
 * rule (deduped by action), in rule priority order, each linked to its group.
 */
function deriveNextActionQueue(ranked: RankedBlocker[]): NextActionItem[] {
  const unresolved = ranked.filter((b) => b.status !== "complete");
  if (unresolved.length === 0) return [];
  const out: NextActionItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < NEXT_ACTION_RULES.length; i++) {
    const rule = NEXT_ACTION_RULES[i];
    const hit = unresolved.find(rule.match);
    if (!hit) continue;
    if (seen.has(rule.action)) continue;
    seen.add(rule.action);
    out.push({
      id: `na-${i}`,
      label: rule.action,
      why: rule.why,
      status: STATUS_LABEL[hit.status],
      groupId: bucketFor(hit.r, hit.impact),
    });
  }
  // Fallback: any remaining unresolved group with no rule hit yet.
  for (const id of GROUP_ORDER) {
    if (out.some((a) => a.groupId === id)) continue;
    const b = unresolved.find((x) => bucketFor(x.r, x.impact) === id);
    if (!b) continue;
    const action = GROUP_NEXT_ACTION[id][b.status];
    if (action && !seen.has(action)) {
      seen.add(action);
      out.push({ id: `na-grp-${id}`, label: action, why: GROUP_EXPLANATION[id], status: STATUS_LABEL[b.status], groupId: id });
    }
  }
  return out;
}

function deriveNextBestAction(ranked: RankedBlocker[]): string | null {
  return deriveNextActionQueue(ranked)[0]?.label ?? null;
}

/**
 * SPEC-…-ACTION-CENTER-1 Phase 3: pure button-presentation rules for one task.
 * Never changes the validated review API — only WHICH buttons show and the
 * primary label/disabled state. Missing tasks never offer Accept/Committee-grade;
 * SOS without a usable official capture cannot be committee-graded without an
 * override; scale plausibility is analyst-conclusion only; a financial file with
 * a missing loan-request checklist item does not present a blanket Committee-grade.
 */
export function deriveTaskActions(t: CommitteeEvidenceTask): TaskActionPlan {
  const resolved = String(t.resolved_status ?? t.status ?? "");
  const taskType = String(t.task_type ?? "");
  const isCommitteeGrade = t.review_status === "committee_grade" || !!t.committee_grade_accepted;
  const acceptable = resolved === "collected" || resolved === "needs_review" || t.review_status === "accepted";
  const checklistMissing = (t.checklist ?? []).some((c) => String(c.status) === "missing");

  const base: TaskActionPlan = {
    primaryLabel: "Review",
    primaryKind: "request_more",
    showAccept: acceptable && !isCommitteeGrade,
    showCommitteeGrade: false,
    committeeGradeDisabled: false,
    committeeGradeBlockedReason: null,
    note: null,
  };

  // Scale plausibility / contradictions: analyst conclusion only — never CG.
  if (t.auto_clear_forbidden || /scale/i.test(taskType)) {
    return { ...base, primaryLabel: "Enter analyst conclusion", primaryKind: "add_conclusion", showAccept: false, showCommitteeGrade: false };
  }

  // Missing tasks: no Accept/Committee-grade; type-aware capture/record CTA.
  if (resolved === "missing") {
    if (/adverse/i.test(taskType)) {
      return { ...base, primaryLabel: "Record result", primaryKind: "record_result", showAccept: false };
    }
    if (/sos|registry/i.test(taskType)) {
      return { ...base, primaryLabel: "Attach official capture", primaryKind: "capture_official", showAccept: false };
    }
    if (/financial_file/i.test(taskType)) {
      return { ...base, primaryLabel: "Add loan request", primaryKind: "add_loan_request", showAccept: false };
    }
    return { ...base, primaryLabel: "Attach evidence", primaryKind: "attach_evidence", showAccept: false };
  }

  // SOS / business registry captured: Committee-grade only with a usable official
  // capture; a search-form/receipt-only capture must capture the detail page first.
  if (/sos|registry/i.test(taskType) || t.blocker_type === "public_entity_verification") {
    if (t.official_capture_available) {
      return { ...base, primaryLabel: "Accept for committee", primaryKind: "mark_committee_grade", showCommitteeGrade: !isCommitteeGrade };
    }
    return {
      ...base,
      primaryLabel: "Attach official capture",
      primaryKind: "capture_official",
      showCommitteeGrade: !isCommitteeGrade,
      committeeGradeDisabled: true,
      committeeGradeBlockedReason:
        "Only a search form / Buddy receipt is captured — attach the official result page, or add an override note, before approving for committee.",
      note:
        t.official_capture_status === "search_form_only"
          ? "Official result page not captured (search form only)."
          : "No official source capture on file (Buddy receipt only).",
    };
  }

  // Financial file: a missing loan-request/use-of-proceeds checklist item means
  // Committee-grade does not resolve everything — disable it with a reason.
  if (/financial_file/i.test(taskType) && checklistMissing) {
    return {
      ...base,
      primaryLabel: "Add loan request",
      primaryKind: "add_loan_request",
      showCommitteeGrade: !isCommitteeGrade,
      committeeGradeDisabled: true,
      committeeGradeBlockedReason: "Some required items are still missing (e.g. loan request / use of proceeds).",
    };
  }

  // Default captured/needs-review task: Committee-grade is the primary.
  return { ...base, primaryLabel: "Accept for committee", primaryKind: "mark_committee_grade", showCommitteeGrade: !isCommitteeGrade };
}

// ── State-aware per-group next action (SPEC-…-STATE-CORRECTNESS-1) ────────────
// Uses the ACTUAL task review/collection state so the default view never tells
// the banker to re-review something already committee-grade, or to "attach/
// accept" something already accepted.

function deriveGroupNextAction(
  id: CommitteeReadinessGroupId,
  members: RankedBlocker[],
): string | null {
  const tasks = members.flatMap((m) => m.r.evidence_tasks ?? []);
  const byType = (tt: string) => tasks.filter((t) => String(t.task_type) === tt);
  const isCG = (t: CommitteeEvidenceTask) => t.review_status === "committee_grade" || !!t.committee_grade_accepted;
  const isAccepted = (t: CommitteeEvidenceTask) => t.review_status === "accepted";
  const resolved = (t: CommitteeEvidenceTask) => taskResolvedStatus(t);
  const captured = (t: CommitteeEvidenceTask) => resolved(t) === "collected" || resolved(t) === "needs_review";
  const allMissing = (ts: CommitteeEvidenceTask[]) => ts.length === 0 || ts.every((t) => resolved(t) === "missing");

  switch (id) {
    case "entity": {
      const website = byType("borrower_website_snapshot");
      const sos = byType("sos_business_registry");
      const websiteCG = website.some(isCG);
      const sosCG = sos.some(isCG);
      const sosCaptured = sos.some((t) => captured(t) && !isCG(t));
      // SPEC-…-UX-REDESIGN-1: a captured SOS without a usable OFFICIAL capture
      // (search-form/receipt only) needs the official result page, not "review".
      const sosNeedsOfficial = sos.some((t) => captured(t) && !isCG(t) && !t.official_capture_available);
      if (sosNeedsOfficial) return "Capture the SOS official result page (search form only — not committee-grade).";
      if (websiteCG && sosCaptured) {
        return "Review the SOS/business registry source and mark it committee-grade, or reject it.";
      }
      if (websiteCG && sosCG) return "Add another official/public source only if required by policy.";
      if (allMissing(sos)) return "Add a Secretary of State or business-registry record for the borrower.";
      return "Review the registry and website records and mark them committee-grade, or reject them.";
    }
    case "management": {
      const att = byType("management_attestation");
      const adverse = byType("public_adverse_screen");
      if (allMissing(att)) return "Attach management/ownership attestation.";
      if (att.some((t) => isAccepted(t) && !isCG(t))) {
        return "Mark management attestation committee-grade if acceptable, and complete the adverse-record screen.";
      }
      if (allMissing(adverse)) return "Complete the adverse-record screen.";
      return "Mark the management/ownership attestation committee-grade, or reject it.";
    }
    case "financial": {
      const loanMissing = members.some((m) => {
        if (mentionsLoanRequest(m.r)) {
          // mentioned in missing_evidence/why — confirm it isn't already on file via checklist
          const ck = (m.r.evidence_tasks ?? []).flatMap((t) => t.checklist ?? []);
          const loanItem = ck.find((c) => /loan request|use of proceeds/i.test(String(c.label ?? "")));
          return loanItem ? loanItem.status === "missing" : true;
        }
        return (m.r.evidence_tasks ?? []).some((t) =>
          (t.checklist ?? []).some((c) => /loan request|use of proceeds/i.test(String(c.label ?? "")) && c.status === "missing"),
        );
      });
      if (loanMissing) return "Add loan request and use-of-proceeds support.";
      return "Tie the loan request and repayment support to the financials, and mark them committee-grade.";
    }
    case "industry": {
      const srcMissing = members.some(
        (m) => /industry|market/i.test(m.r.title ?? "") && allMissing((m.r.evidence_tasks ?? []).filter((t) => String(t.task_type) === "industry_market_source")),
      );
      if (srcMissing) return "Add an industry or market source.";
      return "Confirm the industry, market, and competitor sources are committee-grade.";
    }
    case "risk": {
      const adverse = byType("public_adverse_screen");
      if (adverse.length > 0 && allMissing(adverse)) return "Record the public adverse-record screen result.";
      return "Review the adverse-record screen result and mark it committee-grade.";
    }
    case "scale":
      return "Add an analyst conclusion for scale plausibility.";
    default:
      return null;
  }
}

// ── Decision support (SPEC-BIE-COMMITTEE-DECISION-INTELLIGENCE-1) ─────────────
// Static banker copy per decision: why it matters, acceptable evidence, guidance.
// Evidence found/missing + source links come from the (already banker-ized) group.

const DECISION_SUPPORT_COPY: Record<
  CommitteeReadinessGroupId,
  { reason: string; acceptable: string[]; guidance: string }
> = {
  entity: {
    reason:
      "Committee needs an official public/registry record confirming the borrowing entity is the right company.",
    acceptable: [
      "Secretary of State / business-registry record",
      "Official entity filing",
      "Banker-attested entity confirmation",
    ],
    guidance:
      "Confirm the official entity record (not a search form). Approve only when an official record is on file; otherwise capture it or override with a reason.",
  },
  risk: {
    reason:
      "Committee needs assurance that a public-record / adverse search was run and either found nothing disqualifying or surfaced findings the banker has assessed.",
    acceptable: [
      "Secretary of State / official business-registry result",
      "Court / litigation record search",
      "Regulatory or sanctions check",
      "Lien / UCC search",
      "Banker-attested public-records result",
    ],
    guidance:
      "Record “No findings” only if the search was actually run and clean. If anything surfaced, choose “Findings identified” and document it. Prefer an official capture over a search-form / Buddy receipt.",
  },
  management: {
    reason:
      "Committee needs documented support that management has the experience, role authority, and credibility to execute the business plan.",
    acceptable: [
      "SOS officer / manager listing",
      "Professional license or credential",
      "Resume / bio",
      "Borrower-signed management attestation",
      "PFS or ownership package",
      "Credible public source confirming role / experience",
    ],
    guidance:
      "Approve only if the available file supports management quality for committee. Otherwise add support or request more.",
  },
  financial: {
    reason:
      "Committee needs the loan request, use of proceeds, and repayment / collateral support tied to the financials.",
    acceptable: [
      "Loan request / use of proceeds",
      "DSCR / repayment support",
      "Collateral records",
      "Financial statements / tax returns",
    ],
    guidance:
      "Attach the loan request and repayment / collateral support. Approve only when the financial support is tied together for committee.",
  },
  industry: {
    reason:
      "Committee needs outside support that the borrower's industry, local market, and competitive position are sound — not just the borrower's own claims.",
    acceptable: ["BLS", "Census", "FRED", "IBISWorld", "Statista", "Trade publications", "Local economic-development sources"],
    guidance:
      "Add an outside industry / market source relevant to the borrower's NAICS. Approve only when the sources support the industry position for committee.",
  },
  scale: {
    reason:
      "Business scale asks whether revenue, the loan request / use of proceeds, staffing / capacity, collateral, customer concentration, and industry type make sense together.",
    acceptable: [
      "Revenue support",
      "Use-of-proceeds / loan request",
      "AR / customer-concentration support",
      "Staffing / capacity support",
      "Collateral support",
      "Industry-norm context",
    ],
    guidance:
      "Enter an analyst conclusion explaining why the business is or is not reasonable in scale, citing revenue, request, capacity, collateral, customer concentration, and industry context. This never auto-clears.",
  },
};

const SCALE_SUPPORT_LABEL: Record<string, string> = {
  revenue_support: "Revenue support",
  capacity_support: "Staffing / capacity support",
  ar_customer_concentration_support: "AR / customer-concentration support",
  use_of_proceeds_support: "Use-of-proceeds / loan request",
  analyst_conclusion: "Analyst conclusion",
};

function buildDecisionSupport(
  groupId: CommitteeReadinessGroupId,
  group: CommitteeReadinessGroupView,
  members: RankedBlocker[],
  plan: ResearchGateSnapshot["committeeRequirementsPlan"],
  groupsById: Map<CommitteeReadinessGroupId, CommitteeReadinessGroupView>,
): DecisionSupport {
  const copy = DECISION_SUPPORT_COPY[groupId];
  const evidenceFound = dedupe([...group.alreadyOnFile, ...group.needsReview]).slice(0, 8);
  const evidenceMissing = dedupe([...group.missing]);
  const acceptableEvidence = dedupe([
    ...copy.acceptable,
    ...members.flatMap((m) => m.r.acceptable_evidence_examples ?? []).map((s) => scrub(s)),
  ]).slice(0, 8);

  const sourceLinks: DecisionSourceLink[] = group.capturedSources.map((s) => ({
    label: s.label,
    url: s.officialCaptureUrl ?? s.receiptUrl,
    official: !!s.officialCaptureUrl,
  }));
  const sourceLimitations = group.capturedSources
    .filter((s) => !s.officialCaptureUrl)
    .map((s) =>
      `${s.label}: ${s.officialCaptureStatus === "search_form_only" ? "search form only — not official evidence" : "Buddy receipt only — not official evidence"}`,
    );

  let scaleChecklist: ScaleChecklistItem[] = [];
  if (groupId === "scale") {
    const sp = plan?.scale_plausibility_plan ?? null;
    const present = new Set(sp?.present_supports ?? []);
    const base = (sp?.required_supports ?? ["revenue_support", "use_of_proceeds_support", "ar_customer_concentration_support", "capacity_support"]).filter(
      (k) => k !== "analyst_conclusion",
    );
    scaleChecklist = base.map((k) => ({ label: SCALE_SUPPORT_LABEL[k] ?? scrub(k), present: present.has(k) }));
    // Cross-group context (projected from existing group state — no new facts).
    const fin = groupsById.get("financial");
    const ind = groupsById.get("industry");
    scaleChecklist.push({
      label: "Collateral support",
      present: !!fin && [...fin.alreadyOnFile, ...fin.needsReview].some((s) => /collateral/i.test(s)),
    });
    scaleChecklist.push({
      label: "Industry context",
      present: !!ind && ind.alreadyOnFile.length + ind.needsReview.length > 0,
    });
    for (const k of sp?.missing_supports ?? []) {
      const lbl = SCALE_SUPPORT_LABEL[k];
      if (lbl && k !== "analyst_conclusion" && !evidenceMissing.includes(lbl)) evidenceMissing.push(lbl);
    }
  }

  // "Approve"-style decisions (management/financial/industry/entity) need captured
  // evidence to approve; record/conclusion decisions (risk/scale) keep their copy.
  const isDirectDecision = groupId === "risk" || groupId === "scale";
  const enoughToApprove = isDirectDecision || group.reviewableTasks.length > 0;
  const bankerGuidance = enoughToApprove
    ? copy.guidance
    : "Buddy does not yet have enough support to recommend approval. Add support or request more.";

  return {
    decisionReason: copy.reason,
    evidenceFound,
    evidenceMissing: evidenceMissing.slice(0, 8),
    acceptableEvidence,
    bankerGuidance,
    sourceLinks,
    sourceLimitations,
    scaleChecklist,
    enoughToApprove,
  };
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Project the research-gate snapshot into the simplified, banker-facing
 * committee readiness view. Returns null when there is nothing to show.
 */
// SPEC-BIE-DERIVATION-AUDIT-AND-EVIDENCE-PROMOTION-1 (H): deterministic dedupe of
// committee tasks so duplicate adverse/industry tasks don't inflate counts. The
// most-advanced state wins; item arrays merge. Audit history is untouched (this is
// projection-only — no production rows deleted).
function committeeTaskRank(t: CommitteeEvidenceTask): number {
  if ((t as { committee_grade_accepted?: boolean }).committee_grade_accepted) return 5;
  const rs = String((t as { review_status?: string }).review_status ?? "");
  if (rs === "banker_attested" || rs === "reviewed" || rs === "accepted") return 4;
  const resolved = String((t as { resolved_status?: string }).resolved_status ?? t.status ?? "");
  if (resolved === "collected") return 3;
  if (resolved === "needs_review") return 2;
  return 1;
}
function mergeItemArrays(a: unknown, b: unknown): string[] {
  const out = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map((x) => String(x));
  return [...new Set(out)];
}
export function dedupeCommitteeTasks(tasks: CommitteeEvidenceTask[]): CommitteeEvidenceTask[] {
  const byKey = new Map<string, CommitteeEvidenceTask>();
  const order: string[] = [];
  for (const t of tasks) {
    const title = String((t as { title?: string }).title ?? t.task_type ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = `${String(t.task_type ?? "")}|${title}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, t);
      order.push(key);
      continue;
    }
    const winner = committeeTaskRank(t) > committeeTaskRank(existing) ? t : existing;
    const loser = winner === t ? existing : t;
    byKey.set(key, {
      ...winner,
      collected_items: mergeItemArrays((winner as { collected_items?: unknown }).collected_items, (loser as { collected_items?: unknown }).collected_items),
      missing_items: mergeItemArrays((winner as { missing_items?: unknown }).missing_items, (loser as { missing_items?: unknown }).missing_items),
      needs_review_items: mergeItemArrays((winner as { needs_review_items?: unknown }).needs_review_items, (loser as { needs_review_items?: unknown }).needs_review_items),
    } as CommitteeEvidenceTask);
  }
  return order.map((k) => byKey.get(k)!);
}

export function buildCommitteeReadinessView(
  snapshot: ResearchGateSnapshot,
): CommitteeReadinessView | null {
  const resolutions = (snapshot.committeeBlockerResolutions ?? []).map((r) => ({
    ...r,
    evidence_tasks: dedupeCommitteeTasks(r.evidence_tasks ?? []),
  }));
  if (resolutions.length === 0) return null;

  const section = snapshot.committeeReadinessSection;
  const impactById = new Map<string, CommitteeBlockerImpact>();
  if (section) {
    for (const b of [
      ...(section.resolved_or_reduced_blockers ?? []),
      ...(section.remaining_blockers ?? []),
    ]) {
      impactById.set(b.blocker_id, b);
    }
  }

  const ranked: RankedBlocker[] = resolutions.map((r) => {
    const impact = impactById.get(r.blocker_id);
    return { r, impact, status: classifyBlocker(r, impact) };
  });

  // Counters (blocker-level). Analyst-conclusion items count as "needs review".
  const counters = { ready: 0, needsReview: 0, missing: 0 };
  for (const b of ranked) {
    if (b.status === "complete") counters.ready += 1;
    else if (b.status === "missing") counters.missing += 1;
    else counters.needsReview += 1; // needs_review + needs_analyst_conclusion
  }

  // Group assembly.
  const byGroup = new Map<CommitteeReadinessGroupId, RankedBlocker[]>();
  for (const id of GROUP_ORDER) byGroup.set(id, []);
  for (const b of ranked) byGroup.get(bucketFor(b.r, b.impact))!.push(b);

  const groups: CommitteeReadinessGroupView[] = GROUP_ORDER.map((id) => {
    const members = byGroup.get(id)!;
    // Worst remaining status drives the group label.
    let worst: BankerStatus = "complete";
    for (const m of members) {
      if (STATUS_RANK[m.status] > STATUS_RANK[worst]) worst = m.status;
    }

    const onFile: string[] = [];
    const needsReview: string[] = [];
    const missing: string[] = [];
    const capturedSources: CommitteeReadinessGroupView["capturedSources"] = [];
    const reviewableTasks: CommitteeEvidenceTask[] = [];
    const missingActionableTasks: CommitteeEvidenceTask[] = [];
    const seenArtifactUrls = new Set<string>();
    const seenReviewable = new Set<string>();
    const seenMissing = new Set<string>();
    const push = (b: ItemBucket, label: string) =>
      (b === "onFile" ? onFile : b === "needsReview" ? needsReview : missing).push(label);

    for (const m of members) {
      const tasks = m.r.evidence_tasks ?? [];
      let coveredByItems = false;
      for (const t of tasks) {
        // Prefer per-item coverage-checklist state when present (financial file).
        if (Array.isArray(t.checklist) && t.checklist.length > 0) {
          for (const c of t.checklist) {
            const cls = classifyChecklistItem(String(c.label ?? ""), String(c.status ?? "missing"));
            push(cls.bucket, cls.label);
          }
          coveredByItems = true;
        } else {
          const cls = classifyTaskItem(t);
          push(cls.bucket, cls.label);
          coveredByItems = true;
        }
        // SPEC-BIE-COMMITTEE-READINESS-SINGLE-COMMAND-SURFACE-1: the card is the
        // SINGLE action surface, so every needs-review task is actionable here —
        // whether or not it carries a coverage checklist. (Task-level review
        // state, not checklist items, decides reviewability.)
        if (t.id && !seenReviewable.has(t.id) && classifyTaskItem(t).bucket === "needsReview") {
          seenReviewable.add(t.id);
          reviewableTasks.push(t);
        }
        // SPEC-…-ACTION-CENTER-1 Phase 3: missing tasks get a type-aware capture/
        // record CTA (never Accept/Committee-grade) — UNLESS already resolved by a
        // banker attestation/review (then it's on file, not actionable).
        if (
          t.id &&
          !seenMissing.has(t.id) &&
          taskResolvedStatus(t) === "missing" &&
          !RESOLVING_REVIEW.has(String(t.review_status ?? "")) &&
          !t.committee_grade_accepted
        ) {
          seenMissing.add(t.id);
          missingActionableTasks.push(t);
        }
        // SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1: durable captured source.
        if (t.artifact_view_url && !seenArtifactUrls.has(t.artifact_view_url)) {
          seenArtifactUrls.add(t.artifact_view_url);
          const u = t.artifact_view_url;
          capturedSources.push({
            label: scrub(String(t.title ?? t.task_type ?? "captured source")),
            // Only a USABLE official capture gets an "Official capture" link;
            // a search-form/receipt-only artifact does not (status explains why).
            officialCaptureUrl: t.official_capture_available ? (t.official_capture_view_url ?? `${u}&format=official`) : null,
            officialCaptureStatus: String(t.official_capture_status ?? "none"),
            receiptUrl: t.receipt_view_url ?? u + (u.includes("?") ? "&" : "?") + "format=pdf",
            htmlReceiptUrl: u,
          });
        }
      }
      for (const ev of m.r.existing_supporting_evidence ?? []) {
        if (ev.section) onFile.push(`Research support for ${scrub(ev.section)}`);
      }
      // Fall back to the blocker's generic missing_evidence ONLY when no task/
      // checklist provided real per-item state (avoids listing captured items
      // as "missing").
      if (!coveredByItems && m.status !== "complete") {
        for (const miss of m.r.missing_evidence ?? []) missing.push(`${scrub(miss)} — missing`);
      }
    }

    return {
      id,
      title: GROUP_TITLE[id],
      status: STATUS_LABEL[worst],
      explanation: GROUP_EXPLANATION[id],
      alreadyOnFile: dedupe(onFile).slice(0, 8),
      needsReview: dedupe(needsReview).slice(0, 8),
      missing: dedupe(missing).slice(0, 8),
      nextAction: worst === "complete" ? null : deriveGroupNextAction(id, members) ?? GROUP_NEXT_ACTION[id][worst] ?? null,
      capturedSources: capturedSources.slice(0, 6),
      reviewableTasks: reviewableTasks.slice(0, 6),
      missingActionableTasks: missingActionableTasks.slice(0, 6),
    };
  });

  // Scale plausibility callout.
  const scaleApplies =
    ranked.some((b) => isScaleBlocker(b.r, b.impact)) ||
    snapshot.committeeRequirementsPlan?.scale_plausibility_plan?.applicable === true;

  // Summary.
  const preliminaryClear = section?.preliminary_status.ready ?? snapshot.gatePassed;
  const committeeReady = section?.committee_status.ready ?? snapshot.committeeEligible;
  const summary: CommitteeReadinessSummaryView = {
    preliminaryStatusLabel: preliminaryClear ? "Preliminary is clear" : "Preliminary is not clear yet",
    committeeStatusLabel: committeeReady ? "Committee is ready" : "Committee is not ready yet",
    preliminaryClear,
    committeeReady,
    subcopy: preliminaryClear
      ? "Buddy found enough file and banker-certified evidence to proceed with preliminary underwriting. Committee review still needs the items below."
      : "Committee review still needs the items below.",
    counters,
    nextBestAction: deriveNextBestAction(ranked),
  };

  // SPEC-…-ACTION-CENTER-1 + UX-REDESIGN-1: prioritized guided queue. Reconcile
  // each item's label with its group's state-aware next action (so the queue and
  // the evidence card never show different/duplicated text, and the SOS step
  // reads "capture official result page" when no official capture exists).
  const groupById = new Map(groups.map((g) => [g.id, g] as const));

  // SPEC-…-FINAL-WORKFLOW-CORRECTION-1: ONE canonical executable card per
  // unresolved group, in priority order (rule queue first, then any remaining
  // unresolved group). Next Actions, Committee Blockers, and the hero count all
  // derive from this single list, so they reconcile 1:1.
  const orderedGroupIds: CommitteeReadinessGroupId[] = [];
  for (const a of deriveNextActionQueue(ranked)) {
    if (!orderedGroupIds.includes(a.groupId)) orderedGroupIds.push(a.groupId);
  }
  for (const g of groups) {
    if (g.status !== "Complete" && !orderedGroupIds.includes(g.id)) orderedGroupIds.push(g.id);
  }

  // Decision support + institutional narrative for EVERY group (complete or not),
  // computed once and reused by the action cards. Completed decisions still get a
  // narrative (Approve/High) even though they no longer appear as a Next Action.
  const plan = snapshot.committeeRequirementsPlan ?? null;
  const supportByGroup = new Map(
    groups.map((g) => [g.id, buildDecisionSupport(g.id, g, byGroup.get(g.id) ?? [], plan, groupById)] as const),
  );
  const decisionEvidence = snapshot.committeeDecisionEvidence ?? null;
  const narrativeByGroup = new Map(
    groups.map((g) => [
      g.id,
      buildDecisionNarrative(g.id, g, (byGroup.get(g.id) ?? []).map((m) => m.r), supportByGroup.get(g.id)!, plan, decisionEvidence),
    ] as const),
  );

  const actionCards: CommitteeActionCard[] = orderedGroupIds.map((gid) => {
    const g = groupById.get(gid)!;
    // The task the card resolves: prefer a still-missing task, else a needs-review one.
    const task = [...g.missingActionableTasks, ...g.reviewableTasks][0] ?? null;
    return {
      id: gid,
      // SPEC-…-POLISH-1 (C): the card heading is the banker requirement name; the
      // action verb lives on the primary button (deriveTaskActions.primaryLabel).
      title: GROUP_TITLE[gid],
      why: g.explanation,
      groupId: gid,
      status: g.status,
      task,
      support: supportByGroup.get(gid)!,
      narrative: narrativeByGroup.get(gid)!,
    };
  });
  const decisionNarratives: Record<string, InstitutionalDecisionNarrative> = Object.fromEntries(narrativeByGroup);

  // Back-compat label projection (same order/count as actionCards).
  const nextActions: NextActionItem[] = actionCards.map((c) => ({
    id: c.id,
    label: c.title,
    why: c.why,
    status: c.status,
    groupId: c.groupId,
  }));
  const defaultExpandedGroupId = actionCards[0]?.groupId ?? null;

  // SPEC-…-POLISH-1 (E): compact read-only blocker bullets — ONE per unresolved
  // group, banker-named, reconciling 1:1 with the action cards.
  const committeeBlockers: CommitteeBlockerLine[] = orderedGroupIds.map((gid) => {
    const g = groupById.get(gid)!;
    return {
      label: GROUP_TITLE[gid],
      groupId: gid,
      status: g.status,
    };
  });

  const hero: ReadinessHeroView = {
    statusLine: `${preliminaryClear ? "Preliminary clear" : "Preliminary not clear"} · ${committeeReady ? "Committee ready" : "Committee not ready"}`,
    explanation: preliminaryClear
      ? `Buddy can continue preliminary underwriting, but committee review still needs ${actionCards.length} action(s).`
      : "Research is not yet clear enough for preliminary underwriting.",
    progress: counters,
    primaryActionLabel: actionCards[0]?.title ?? null,
    actionsRequired: actionCards.length,
  };

  // Audit projection — the ONLY place machine vocabulary is allowed.
  const audit: CommitteeReadinessAuditRow[] = ranked.map((b) => ({
    blocker_id: b.r.blocker_id,
    blocker_type: b.r.blocker_type,
    resolved_status: b.r.current_status,
    impact_status: b.impact?.impact_status ?? null,
    linked_evidence_count: (b.r.existing_supporting_evidence ?? []).length,
    tasks: (b.r.evidence_tasks ?? []).map((t) => ({
      task_type: String(t.task_type ?? ""),
      resolved_status: taskResolvedStatus(t),
      review_status: String(t.review_status ?? "unreviewed"),
      committee_grade_accepted: !!t.committee_grade_accepted,
      auto_clear_forbidden: !!t.auto_clear_forbidden,
      linked_evidence_count: t.linked_evidence?.length ?? 0,
      artifact_view_url: t.artifact_view_url ?? null,
    })),
  }));

  return {
    summary,
    hero,
    actionCards,
    nextActions,
    defaultExpandedGroupId,
    groups,
    committeeBlockers,
    decisionNarratives,
    scalePlausibility: scaleApplies ? SCALE_PLAUSIBILITY : null,
    audit,
  };
}

/**
 * SPEC-BIE-COMMITTEE-DECISION-INTELLIGENCE-1: per-decision support, keyed by
 * group, projected from existing BIE data. Returns {} when nothing to show.
 */
export function buildCommitteeDecisionSupportView(
  snapshot: ResearchGateSnapshot,
): Record<string, DecisionSupport> {
  const view = buildCommitteeReadinessView(snapshot);
  if (!view) return {};
  return Object.fromEntries(view.actionCards.map((c) => [c.groupId, c.support]));
}

/**
 * SPEC-BIE-INSTITUTIONAL-DECISION-NARRATIVES-1: per-decision institutional
 * narratives (conclusion / recommendation / confidence / findings / evidence /
 * gaps / risks), keyed by group. Pure projection of existing snapshot data.
 */
export function buildInstitutionalDecisionNarratives(
  snapshot: ResearchGateSnapshot,
): Record<string, InstitutionalDecisionNarrative> {
  return buildCommitteeReadinessView(snapshot)?.decisionNarratives ?? {};
}

/**
 * Concatenate every banker-visible string in the default view (everything except
 * the `audit` projection). Test helper used to assert machine vocabulary never
 * leaks into the default surface.
 */
export function defaultViewText(view: CommitteeReadinessView): string {
  const parts: string[] = [
    view.summary.preliminaryStatusLabel,
    view.summary.committeeStatusLabel,
    view.summary.subcopy,
    view.summary.nextBestAction ?? "",
    view.hero.statusLine,
    view.hero.explanation,
    view.hero.primaryActionLabel ?? "",
  ];
  for (const a of view.nextActions) parts.push(a.label, a.why);
  for (const c of view.actionCards) {
    const s = c.support;
    parts.push(s.decisionReason, s.bankerGuidance, ...s.evidenceFound, ...s.evidenceMissing, ...s.acceptableEvidence, ...s.sourceLimitations);
    parts.push(...s.scaleChecklist.map((i) => i.label));
    const n = c.narrative;
    parts.push(n.domain, n.conclusion, n.recommendation, n.bankerGuidance, ...n.keyFindings, ...n.evidenceGaps, ...n.riskNotes, ...n.evidenceUsed.map((e) => e.label));
  }
  for (const b of view.committeeBlockers) parts.push(b.label);
  for (const g of view.groups) {
    parts.push(g.title, g.status, g.explanation, g.nextAction ?? "");
    parts.push(...g.alreadyOnFile, ...g.needsReview, ...g.missing);
    parts.push(...g.capturedSources.map((s) => s.label));
  }
  if (view.scalePlausibility) {
    parts.push(
      view.scalePlausibility.label,
      view.scalePlausibility.explanation,
      view.scalePlausibility.nextAction,
    );
  }
  return parts.join(" \n ");
}
