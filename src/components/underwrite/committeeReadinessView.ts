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
  | "risk";

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
   * SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1: durable captured-source
   * loan-file artifacts the banker can open from the default view.
   */
  capturedSources: { label: string; url: string }[];
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
  groups: CommitteeReadinessGroupView[];
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
];

const GROUP_TITLE: Record<CommitteeReadinessGroupId, string> = {
  entity: "Entity & public record",
  management: "Management & ownership",
  financial: "Financial & loan support",
  industry: "Industry, market & competition",
  risk: "Risk & red flags",
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
    "Committee needs documented risk checks and an analyst conclusion on scale plausibility.",
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
    missing: "Complete the adverse-record screen and document the risk checks.",
    needs_review: "Review the risk checks and record an analyst conclusion.",
    needs_analyst_conclusion: "Add an analyst conclusion with supporting evidence.",
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
  if (impact?.blocker_type === "scale_plausibility" || impact?.blocker_type === "contradiction") {
    return "risk";
  }
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

function deriveNextBestAction(ranked: RankedBlocker[]): string | null {
  const unresolved = ranked.filter((b) => b.status !== "complete");
  if (unresolved.length === 0) return null;

  const rules: Array<{ match: (b: RankedBlocker) => boolean; action: string }> = [
    // 1. Any wrong-entity / rejected source.
    {
      match: (b) =>
        /wrong\/conflicting|conflicting public entity/i.test(b.r.title ?? "") ||
        hasRejectedOrWrongEntityEvidence(b.r),
      action: "Resolve the wrong or conflicting borrower entity before committee review.",
    },
    // 2. Adverse screen missing.
    {
      match: (b) => isAdverseScreenBlocker(b.r) && b.status !== "complete",
      action: "Complete the adverse-record screen.",
    },
    // 3. Loan request / use-of-proceeds missing.
    {
      match: (b) =>
        bucketFor(b.r, b.impact) === "financial" &&
        mentionsLoanRequest(b.r) &&
        b.status !== "complete",
      action: "Add loan request and use-of-proceeds support.",
    },
    // 4. SOS / business registry needs review.
    {
      match: (b) =>
        (b.r.blocker_type === "public_entity_verification" ||
          b.r.blocker_type === "source_quality") &&
        b.status === "needs_review",
      action: "Review the Secretary of State record and mark it committee-grade, or reject it.",
    },
    // 5. Management attestation needs review.
    {
      match: (b) => b.r.blocker_type === "management_verification" && b.status === "needs_review",
      action: "Attach or accept the management/ownership attestation.",
    },
    // 6. Industry / market source missing.
    {
      match: (b) =>
        bucketFor(b.r, b.impact) === "industry" &&
        /industry|market/i.test(b.r.title ?? "") &&
        !/competit/i.test(b.r.title ?? "") &&
        b.status === "missing",
      action: "Add an industry or market source.",
    },
    // 7. Competitor support needs review.
    {
      match: (b) => /competit/i.test(b.r.title ?? "") && b.status !== "complete",
      action: "Add committee-grade competitor support.",
    },
    // 8. Scale plausibility analyst conclusion.
    {
      match: (b) => isScaleBlocker(b.r, b.impact) && b.status !== "complete",
      action: "Add an analyst conclusion for scale plausibility.",
    },
  ];

  for (const rule of rules) {
    if (unresolved.some(rule.match)) return rule.action;
  }
  // Fallback: any remaining group's curated next action (priority group order).
  for (const id of GROUP_ORDER) {
    const b = unresolved.find((x) => bucketFor(x.r, x.impact) === id);
    if (b) {
      const action = GROUP_NEXT_ACTION[id][b.status];
      if (action) return action;
    }
  }
  return null;
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
      if (adverse.length > 0 && allMissing(adverse)) return "Complete the adverse-record screen.";
      return "Add an analyst conclusion for scale plausibility with supporting evidence.";
    }
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
    const capturedSources: { label: string; url: string }[] = [];
    const seenArtifactUrls = new Set<string>();
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
        // SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1: durable captured source.
        if (t.artifact_view_url && !seenArtifactUrls.has(t.artifact_view_url)) {
          seenArtifactUrls.add(t.artifact_view_url);
          capturedSources.push({ label: scrub(String(t.title ?? t.task_type ?? "captured source")), url: t.artifact_view_url });
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
    groups,
    scalePlausibility: scaleApplies ? SCALE_PLAUSIBILITY : null,
    audit,
  };
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
  ];
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
