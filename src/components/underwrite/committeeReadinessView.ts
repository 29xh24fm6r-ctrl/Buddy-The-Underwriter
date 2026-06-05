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
}

/** SPEC-…-UX-REDESIGN-1: one exact committee blocker (shown once). */
export interface CommitteeBlockerLine {
  label: string;
  groupId: CommitteeReadinessGroupId;
  status: GroupStatusLabel;
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
  /** SPEC-…-ACTION-CENTER-1: prioritized guided queue (top item first). */
  nextActions: NextActionItem[];
  /** The group of the top next action — the only card expanded by default. */
  defaultExpandedGroupId: CommitteeReadinessGroupId | null;
  groups: CommitteeReadinessGroupView[];
  /** SPEC-…-UX-REDESIGN-1: exact committee blockers, deduped, shown once. */
  committeeBlockers: CommitteeBlockerLine[];
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

const GROUP_TITLE: Record<CommitteeReadinessGroupId, string> = {
  entity: "Entity & public record",
  management: "Management & ownership",
  financial: "Financial & loan support",
  industry: "Industry, market & competition",
  risk: "Risk & red flags",
  scale: "Scale plausibility",
};

const GROUP_EXPLANATION: Record<CommitteeReadinessGroupId, string> = {
  entity:
    "We need reliable public or official records showing this is the right company.",
  management:
    "We have management support for preliminary review, but committee needs reviewed or attested evidence.",
  financial:
    "Committee needs the loan request, repayment support, and collateral/financial evidence tied together.",
  industry:
    "Committee needs outside support for industry, local market, and competitor claims.",
  risk:
    "Committee needs documented public risk/adverse-record checks.",
  scale:
    "Committee needs an analyst conclusion that the borrower's revenue, request, growth story, staffing, and collateral are consistent in scale.",
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
    return { bucket: "onFile", label: `${title} — accepted as committee-grade` };
  }
  if (t.review_status === "rejected" || t.review_status === "weak_source" || t.review_status === "wrong_entity") {
    return { bucket: "missing", label: `${title} — re-collect (${scrub(t.review_status)})` };
  }
  if (t.review_status === "accepted" || resolved === "accepted") {
    return { bucket: "needsReview", label: `${title} — accepted for preliminary; committee-grade review still needed` };
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
    return { ...base, primaryLabel: "Add analyst conclusion", primaryKind: "add_conclusion", showAccept: false, showCommitteeGrade: false };
  }

  // Missing tasks: no Accept/Committee-grade; type-aware capture/record CTA.
  if (resolved === "missing") {
    if (/adverse/i.test(taskType)) {
      return { ...base, primaryLabel: "Record adverse-screen result", primaryKind: "record_result", showAccept: false };
    }
    if (/sos|registry/i.test(taskType)) {
      return { ...base, primaryLabel: "Capture official result page", primaryKind: "capture_official", showAccept: false };
    }
    if (/financial_file/i.test(taskType)) {
      return { ...base, primaryLabel: "Add loan request / use-of-proceeds", primaryKind: "add_loan_request", showAccept: false };
    }
    return { ...base, primaryLabel: "Attach evidence", primaryKind: "attach_evidence", showAccept: false };
  }

  // SOS / business registry captured: Committee-grade only with a usable official
  // capture; a search-form/receipt-only capture must capture the detail page first.
  if (/sos|registry/i.test(taskType) || t.blocker_type === "public_entity_verification") {
    if (t.official_capture_available) {
      return { ...base, primaryLabel: "Mark committee-grade", primaryKind: "mark_committee_grade", showCommitteeGrade: !isCommitteeGrade };
    }
    return {
      ...base,
      primaryLabel: "Capture official result page",
      primaryKind: "capture_official",
      showCommitteeGrade: !isCommitteeGrade,
      committeeGradeDisabled: true,
      committeeGradeBlockedReason:
        "Only a search form / Buddy receipt is captured — attach the official result page, or add an override note, before committee-grade.",
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
      primaryLabel: "Add loan request / use-of-proceeds",
      primaryKind: "add_loan_request",
      showCommitteeGrade: !isCommitteeGrade,
      committeeGradeDisabled: true,
      committeeGradeBlockedReason: "Some required items are still missing (e.g. loan request / use of proceeds).",
    };
  }

  // Default captured/needs-review task: Committee-grade is the primary.
  return { ...base, primaryLabel: "Mark committee-grade", primaryKind: "mark_committee_grade", showCommitteeGrade: !isCommitteeGrade };
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

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Project the research-gate snapshot into the simplified, banker-facing
 * committee readiness view. Returns null when there is nothing to show.
 */
export function buildCommitteeReadinessView(
  snapshot: ResearchGateSnapshot,
): CommitteeReadinessView | null {
  const resolutions = snapshot.committeeBlockerResolutions ?? [];
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
        // record CTA (never Accept/Committee-grade).
        if (t.id && !seenMissing.has(t.id) && taskResolvedStatus(t) === "missing") {
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
  const nextActions = deriveNextActionQueue(ranked).map((a) => {
    const g = groupById.get(a.groupId);
    return g && g.nextAction ? { ...a, label: g.nextAction, status: g.status } : a;
  });
  const defaultExpandedGroupId = nextActions[0]?.groupId ?? null;

  // SPEC-…-UX-REDESIGN-1: hero + the exact committee blockers (one per unresolved
  // blocker, deduped) so the visible blocker list reconciles with the counters.
  const hero: ReadinessHeroView = {
    statusLine: `${preliminaryClear ? "Preliminary clear" : "Preliminary not clear"} · ${committeeReady ? "Committee ready" : "Committee not ready"}`,
    explanation: preliminaryClear
      ? `Buddy can continue preliminary underwriting, but committee review still needs ${counters.needsReview + counters.missing} item(s).`
      : "Research is not yet clear enough for preliminary underwriting.",
    progress: counters,
    primaryActionLabel: nextActions[0]?.label ?? null,
  };

  const committeeBlockers: CommitteeBlockerLine[] = [];
  const seenBlockerLabel = new Set<string>();
  for (const b of ranked) {
    if (b.status === "complete") continue;
    const label = bankerBlockerLabel(b);
    const key = label.toLowerCase();
    if (seenBlockerLabel.has(key)) continue;
    seenBlockerLabel.add(key);
    committeeBlockers.push({ label, groupId: bucketFor(b.r, b.impact), status: STATUS_LABEL[b.status] });
  }

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
    nextActions,
    defaultExpandedGroupId,
    groups,
    committeeBlockers,
    scalePlausibility: scaleApplies ? SCALE_PLAUSIBILITY : null,
    audit,
  };
}

/**
 * SPEC-…-UX-REDESIGN-1: a precise banker label for one committee blocker. Known
 * blockers get the spec's exact wording; others get a scrubbed title. NEVER
 * treats a Buddy receipt as official evidence.
 */
function bankerBlockerLabel(b: RankedBlocker): string {
  if (isScaleBlocker(b.r, b.impact)) return "Scale plausibility needs analyst conclusion";
  const group = bucketFor(b.r, b.impact);
  if (group === "entity") {
    const sos = (b.r.evidence_tasks ?? []).filter((t) => /sos|registry/i.test(String(t.task_type)));
    const sosCapturedNoOfficial = sos.some(
      (t) => taskResolvedStatus(t) !== "missing" && !t.official_capture_available,
    );
    if (sosCapturedNoOfficial) return "SOS official capture unavailable — search form only (Buddy receipt is not official evidence)";
  }
  if (group === "risk") return "Public adverse-record screen result not on file";
  const title = scrub(b.r.title ?? "committee evidence");
  return title.charAt(0).toUpperCase() + title.slice(1);
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
