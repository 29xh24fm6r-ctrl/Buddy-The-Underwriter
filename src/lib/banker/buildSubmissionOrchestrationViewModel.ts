/**
 * Intelligent Submission Orchestration — View Model Builder
 *
 * Deterministic, pure-function synthesizer that compiles banker-side
 * submission orchestration intelligence from the borrower intelligence stack:
 * operational continuity, documents, communication, submission readiness,
 * trust review, and optional banker-persisted review/submission state.
 *
 * Spec: 15R / Spec 14 — Intelligent Submission Orchestration
 *
 * Rules:
 * - Pure function, no DB / network calls
 * - Operational orchestration only — never approval, lender, or credit signals
 * - Real state only — never invents banker review timestamps, submitted state,
 *   or lender behavior
 * - Banker review and submission gates default to needs_review when no
 *   persisted state is supplied; submitted state is NEVER claimed without
 *   real persisted evidence
 * - Deterministic ordering for testability
 * - Safe fallback for empty / minimal input
 */

import type { BorrowerOperationalContinuityViewModel } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import type { BorrowerDocumentExperienceViewModel } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import type { BorrowerCommunicationViewModel } from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import type { BorrowerSubmissionReadinessViewModel } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";
import type { BorrowerTrustReviewViewModel } from "@/lib/borrower/buildBorrowerTrustReviewViewModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubmissionOrchestrationState =
  | "not_started"
  | "preparing_package"
  | "awaiting_clarifications"
  | "package_review"
  | "ready_for_submission"
  | "submission_in_progress"
  | "submitted";

export type SubmissionGateStatus =
  | "passed"
  | "blocked"
  | "needs_review"
  | "not_applicable"
  | "unavailable";

export type SubmissionReadinessGateId =
  | "required_documents_received"
  | "required_sba_forms_received"
  | "borrower_confirmations_reviewed"
  | "unresolved_attention_items_reviewed"
  | "required_clarifications_resolved"
  | "package_inventory_reviewed"
  | "banker_submission_review_complete";

export type SubmissionReadinessGate = {
  id: SubmissionReadinessGateId;
  label: string;
  status: SubmissionGateStatus;
  explanation: string;
  blocking: boolean;
  href?: string;
};

export type SubmissionPackageSectionStatus =
  | "complete"
  | "partial"
  | "needs_attention"
  | "unavailable";

export type SubmissionPackageItemStatus =
  | "included"
  | "missing"
  | "needs_attention"
  | "unavailable";

export type SubmissionPackageItem = {
  id: string;
  label: string;
  status: SubmissionPackageItemStatus;
  href?: string;
};

export type SubmissionPackageSectionId =
  | "financial_package"
  | "sba_forms"
  | "ownership_identity"
  | "business_verification"
  | "supporting_documents"
  | "clarification_notes"
  | "banker_review_notes";

export type SubmissionPackageSection = {
  id: SubmissionPackageSectionId;
  label: string;
  status: SubmissionPackageSectionStatus;
  includedCount: number;
  missingCount: number;
  needsAttentionCount: number;
  items: SubmissionPackageItem[];
};

export type SubmissionClarificationStatus =
  | "open"
  | "needs_review"
  | "resolved"
  | "unavailable";

export type SubmissionClarificationSource =
  | "document"
  | "communication"
  | "guidance"
  | "submission_prep"
  | "banker_review";

export type SubmissionClarificationItem = {
  id: string;
  label: string;
  reason: string;
  status: SubmissionClarificationStatus;
  priority: "required" | "helpful" | "optional";
  source: SubmissionClarificationSource;
  href?: string;
};

export type SubmissionOrchestrationNextActionId =
  | "review_readiness_gates"
  | "resolve_clarifications"
  | "review_package_inventory"
  | "request_missing_items"
  | "complete_banker_review"
  | "prepare_lender_submission"
  | "monitor_submission_progress"
  | "no_action_available";

export type SubmissionOrchestrationNextAction = {
  id: SubmissionOrchestrationNextActionId;
  label: string;
  rationale: string;
  urgency: "low" | "normal" | "high";
  href?: string;
};

export type SubmissionOrchestrationTimelineCategory =
  | "gate"
  | "package"
  | "clarification"
  | "banker_review"
  | "borrower_action"
  | "submission";

export type SubmissionOrchestrationTimelineEvent = {
  id: string;
  label: string;
  timestamp?: string;
  category: SubmissionOrchestrationTimelineCategory;
};

export type SubmissionOrchestrationViewModel = {
  state: SubmissionOrchestrationState;
  headline: string;
  summary: string;
  gates: SubmissionReadinessGate[];
  packageSections: SubmissionPackageSection[];
  clarifications: SubmissionClarificationItem[];
  nextAction: SubmissionOrchestrationNextAction;
  timeline: SubmissionOrchestrationTimelineEvent[];
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type SubmissionOrchestrationActivityEvent = {
  id: string;
  label: string;
  timestamp?: string | null;
  category: SubmissionOrchestrationTimelineCategory;
};

export type PersistedBankerReviewState = {
  /** Real timestamp when banker marked the package inventory reviewed. */
  packageInventoryReviewedAt?: string | null;
  /** Real timestamp when banker completed the submission review gate. */
  submissionReviewCompletedAt?: string | null;
  /** Banker free-form review notes (optional, banker-supplied). */
  reviewNotes?: string | null;
};

export type PersistedSubmissionState = {
  /** Real timestamp when submission preparation started. */
  submissionStartedAt?: string | null;
  /** Real timestamp of actual submission. NEVER fabricate. */
  submittedAt?: string | null;
};

export type SubmissionOrchestrationInput = {
  dealId: string;
  documents: BorrowerDocumentExperienceViewModel;
  communication: BorrowerCommunicationViewModel;
  submission: BorrowerSubmissionReadinessViewModel;
  trustReview: BorrowerTrustReviewViewModel;
  continuity: BorrowerOperationalContinuityViewModel;
  /** Optional banker-persisted review state (gates/notes). */
  bankerReview?: PersistedBankerReviewState;
  /** Optional persisted submission state (in-progress or submitted). */
  submissionState?: PersistedSubmissionState;
  /** Optional real activity events. No timestamps are fabricated. */
  activity?: SubmissionOrchestrationActivityEvent[];
  /** Optional href for resolving gates / opening package surfaces */
  prepareSubmissionHref?: string | null;
  reviewPackageHref?: string | null;
  resolveClarificationsHref?: string | null;
  requestDocumentsHref?: string | null;
  /** Cap on timeline events. Default 6. */
  maxTimelineEvents?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimOrNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function countStrictlyMissingRequired(
  documents: BorrowerDocumentExperienceViewModel,
): number {
  let count = 0;
  for (const group of documents.groups) {
    for (const req of group.requirements) {
      if (req.required && req.status === "missing") count += 1;
    }
  }
  return count;
}

function gatherDocumentItemsByGroupIds(
  documents: BorrowerDocumentExperienceViewModel,
  groupIds: ReadonlyArray<string>,
): {
  items: SubmissionPackageItem[];
  included: number;
  missing: number;
  needsAttention: number;
} {
  const items: SubmissionPackageItem[] = [];
  let included = 0;
  let missing = 0;
  let needsAttention = 0;
  for (const group of documents.groups) {
    if (!groupIds.includes(group.id)) continue;
    for (const req of group.requirements) {
      let status: SubmissionPackageItemStatus;
      switch (req.status) {
        case "accepted":
        case "received":
        case "reviewing":
        case "uploaded":
          status = "included";
          included += 1;
          break;
        case "needs_attention":
          status = "needs_attention";
          needsAttention += 1;
          break;
        case "missing":
          status = req.required ? "missing" : "unavailable";
          if (req.required) missing += 1;
          break;
        case "optional":
        case "unavailable":
        default:
          status = "unavailable";
          break;
      }
      const item: SubmissionPackageItem = {
        id: `doc_${req.id}`,
        label: req.label,
        status,
      };
      const href = trimOrNull(req.href ?? null) ?? undefined;
      if (href) item.href = href;
      items.push(item);
    }
  }
  return { items, included, missing, needsAttention };
}

function deriveSectionStatus(opts: {
  included: number;
  missing: number;
  needsAttention: number;
  totalKnown: number;
}): SubmissionPackageSectionStatus {
  if (opts.totalKnown === 0) return "unavailable";
  if (opts.needsAttention > 0) return "needs_attention";
  if (opts.missing > 0) return "partial";
  if (opts.included > 0) return "complete";
  return "unavailable";
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function buildGates(
  input: SubmissionOrchestrationInput,
): SubmissionReadinessGate[] {
  const pkg = input.documents.packageSummary;
  const missingRequired = countStrictlyMissingRequired(input.documents);
  const attention = pkg.needsAttention;
  const trustReviewed = input.trustReview.state === "reviewed";
  const bankerReview = input.bankerReview ?? {};
  const persistedInventory = !!trimOrNull(bankerReview.packageInventoryReviewedAt);
  const persistedSubmissionReview = !!trimOrNull(
    bankerReview.submissionReviewCompletedAt,
  );
  const requestHref = trimOrNull(input.requestDocumentsHref) ?? undefined;
  const reviewHref = trimOrNull(input.reviewPackageHref) ?? undefined;
  const resolveHref = trimOrNull(input.resolveClarificationsHref) ?? undefined;

  // SBA forms group: derive purely from documents.groups
  const sbaGroup = input.documents.groups.find((g) => g.id === "sba_forms");
  const sbaRequired = sbaGroup
    ? sbaGroup.requirements.filter((r) => r.required).length
    : 0;
  const sbaReceived = sbaGroup
    ? sbaGroup.requirements.filter(
        (r) =>
          r.required &&
          (r.status === "accepted" ||
            r.status === "received" ||
            r.status === "reviewing" ||
            r.status === "uploaded"),
      ).length
    : 0;

  const gates: SubmissionReadinessGate[] = [];

  // 1. Required documents received
  gates.push({
    id: "required_documents_received",
    label: "All required documents received",
    status:
      pkg.requiredTotal === 0
        ? "unavailable"
        : missingRequired === 0
          ? "passed"
          : "blocked",
    explanation:
      pkg.requiredTotal === 0
        ? "Document request list is not yet available."
        : missingRequired === 0
          ? `All ${pkg.requiredTotal} required item${pkg.requiredTotal === 1 ? "" : "s"} are in the package.`
          : `${missingRequired} required item${missingRequired === 1 ? "" : "s"} missing from the borrower.`,
    blocking: true,
    ...(missingRequired > 0 && requestHref ? { href: requestHref } : {}),
  });

  // 2. Required SBA forms — `not_applicable` when no SBA form requirements
  // were ever published (some deals don't carry SBA forms at this stage).
  gates.push({
    id: "required_sba_forms_received",
    label: "Required SBA forms received",
    status:
      sbaRequired === 0
        ? "not_applicable"
        : sbaReceived === sbaRequired
          ? "passed"
          : "blocked",
    explanation:
      sbaRequired === 0
        ? "No SBA form requirements are currently published for this deal."
        : sbaReceived === sbaRequired
          ? `${sbaReceived} of ${sbaRequired} SBA form${sbaRequired === 1 ? "" : "s"} received.`
          : `${sbaRequired - sbaReceived} SBA form${sbaRequired - sbaReceived === 1 ? "" : "s"} still needed.`,
    blocking: true,
    ...(sbaRequired > sbaReceived && requestHref ? { href: requestHref } : {}),
  });

  // 3. Borrower confirmations reviewed
  gates.push({
    id: "borrower_confirmations_reviewed",
    label: "Borrower confirmations reviewed",
    status: trustReviewed ? "passed" : "needs_review",
    explanation: trustReviewed
      ? "Borrower has saved confirmations of business, ownership, and contact details."
      : "Borrower confirmations have not been saved yet — review the trust panel before submission.",
    blocking: false,
    ...(reviewHref ? { href: reviewHref } : {}),
  });

  // 4. Unresolved attention items reviewed
  gates.push({
    id: "unresolved_attention_items_reviewed",
    label: "Attention items resolved",
    status: attention === 0 ? "passed" : "blocked",
    explanation:
      attention === 0
        ? "No documents currently flagged for attention."
        : `${attention} item${attention === 1 ? "" : "s"} flagged for attention on borrower documents.`,
    blocking: true,
    ...(attention > 0 && resolveHref ? { href: resolveHref } : {}),
  });

  // 5. Required clarifications resolved
  const clarificationsNeeded =
    input.communication.waitingOn === "clarification" || attention > 0;
  gates.push({
    id: "required_clarifications_resolved",
    label: "Required clarifications resolved",
    status: clarificationsNeeded ? "blocked" : "passed",
    explanation: clarificationsNeeded
      ? "One or more borrower-supplied items need clarification before continuing."
      : "No outstanding clarifications on the borrower side.",
    blocking: true,
    ...(clarificationsNeeded && resolveHref ? { href: resolveHref } : {}),
  });

  // 6. Package inventory reviewed (banker review surface)
  gates.push({
    id: "package_inventory_reviewed",
    label: "Banker reviewed package inventory",
    status: persistedInventory ? "passed" : "needs_review",
    explanation: persistedInventory
      ? "Banker has reviewed the package inventory."
      : "Banker has not yet reviewed the assembled package inventory.",
    blocking: false,
    ...(!persistedInventory && reviewHref ? { href: reviewHref } : {}),
  });

  // 7. Banker submission review complete
  gates.push({
    id: "banker_submission_review_complete",
    label: "Banker completed submission review",
    status: persistedSubmissionReview ? "passed" : "needs_review",
    explanation: persistedSubmissionReview
      ? "Banker has marked the submission review complete."
      : "Banker has not yet completed the final submission review.",
    blocking: true,
    ...(!persistedSubmissionReview && reviewHref ? { href: reviewHref } : {}),
  });

  return gates;
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

function deriveState(
  input: SubmissionOrchestrationInput,
  gates: SubmissionReadinessGate[],
): SubmissionOrchestrationState {
  const persistedSubmitted = trimOrNull(
    input.submissionState?.submittedAt ?? null,
  );
  if (persistedSubmitted) return "submitted";

  const persistedStarted = trimOrNull(
    input.submissionState?.submissionStartedAt ?? null,
  );
  if (persistedStarted) return "submission_in_progress";

  const pkg = input.documents.packageSummary;
  const missingRequired = countStrictlyMissingRequired(input.documents);

  // Nothing tracked yet
  if (pkg.requiredTotal === 0 && pkg.requiredReceived === 0) {
    return "not_started";
  }
  if (pkg.requiredReceived === 0) return "preparing_package";

  // Clarifications take priority over package-review optimism
  const clarificationsNeeded =
    input.communication.waitingOn === "clarification" || pkg.needsAttention > 0;
  if (clarificationsNeeded) return "awaiting_clarifications";

  // Still missing required docs → preparing
  if (missingRequired > 0) return "preparing_package";

  // All blocking gates passed (or not_applicable) → ready_for_submission
  const blockingGatesPassed = gates
    .filter((g) => g.blocking)
    .every((g) => g.status === "passed" || g.status === "not_applicable");
  if (blockingGatesPassed) return "ready_for_submission";

  // Required docs in, but banker hasn't completed review yet
  return "package_review";
}

// ---------------------------------------------------------------------------
// Headline / summary
// ---------------------------------------------------------------------------

const STATE_HEADLINES: Record<SubmissionOrchestrationState, string> = {
  not_started: "Submission orchestration hasn't started yet.",
  preparing_package: "Package is still being assembled.",
  awaiting_clarifications: "Awaiting borrower clarifications before submission review.",
  package_review: "Package is awaiting banker review before submission.",
  ready_for_submission: "Package is operationally ready for lender submission.",
  submission_in_progress: "Submission preparation is in progress.",
  submitted: "Submission preparation marked complete.",
};

function buildSummary(
  input: SubmissionOrchestrationInput,
  state: SubmissionOrchestrationState,
): string {
  const pkg = input.documents.packageSummary;
  const remaining = pkg.requiredRemaining;
  const attention = pkg.needsAttention;
  switch (state) {
    case "not_started":
      return "No required items have been published yet for this deal.";
    case "preparing_package":
      return `${remaining} required item${remaining === 1 ? "" : "s"} still needed before banker review.`;
    case "awaiting_clarifications":
      return attention > 0
        ? `${attention} item${attention === 1 ? "" : "s"} flagged for attention before review continues.`
        : "Borrower clarification is outstanding before submission review.";
    case "package_review":
      return "Required items appear received. Banker review of the assembled package is the next step.";
    case "ready_for_submission":
      return "All blocking gates passed. The package is operationally ready for lender submission preparation.";
    case "submission_in_progress":
      return "Submission preparation has started and is being orchestrated.";
    case "submitted":
      return "Submission preparation has been marked complete.";
  }
}

// ---------------------------------------------------------------------------
// Package sections
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<SubmissionPackageSectionId, string> = {
  financial_package: "Financial package",
  sba_forms: "SBA forms",
  ownership_identity: "Ownership & identity",
  business_verification: "Business verification",
  supporting_documents: "Supporting documents",
  clarification_notes: "Clarification notes",
  banker_review_notes: "Banker review notes",
};

const SECTION_ORDER: SubmissionPackageSectionId[] = [
  "financial_package",
  "sba_forms",
  "ownership_identity",
  "business_verification",
  "supporting_documents",
  "clarification_notes",
  "banker_review_notes",
];

function buildPackageSections(
  input: SubmissionOrchestrationInput,
  clarifications: SubmissionClarificationItem[],
): SubmissionPackageSection[] {
  const sections: SubmissionPackageSection[] = [];

  const documentSectionMap: Record<
    Exclude<SubmissionPackageSectionId, "clarification_notes" | "banker_review_notes">,
    ReadonlyArray<string>
  > = {
    financial_package: ["business_financials", "tax_returns"],
    sba_forms: ["sba_forms"],
    ownership_identity: ["ownership_identity"],
    business_verification: ["business_documents"],
    supporting_documents: ["supporting_documents"],
  };

  for (const id of SECTION_ORDER) {
    if (id === "clarification_notes") {
      const items: SubmissionPackageItem[] = clarifications.map((c) => {
        const item: SubmissionPackageItem = {
          id: `clar_${c.id}`,
          label: c.label,
          status:
            c.status === "resolved"
              ? "included"
              : c.status === "unavailable"
                ? "unavailable"
                : "needs_attention",
        };
        const href = trimOrNull(c.href ?? null) ?? undefined;
        if (href) item.href = href;
        return item;
      });
      const included = items.filter((i) => i.status === "included").length;
      const needsAttention = items.filter((i) => i.status === "needs_attention").length;
      sections.push({
        id,
        label: SECTION_LABELS[id],
        status:
          items.length === 0
            ? "unavailable"
            : needsAttention > 0
              ? "needs_attention"
              : included === items.length
                ? "complete"
                : "partial",
        includedCount: included,
        missingCount: 0,
        needsAttentionCount: needsAttention,
        items,
      });
      continue;
    }
    if (id === "banker_review_notes") {
      const notes = trimOrNull(input.bankerReview?.reviewNotes ?? null);
      const items: SubmissionPackageItem[] = notes
        ? [
            {
              id: "banker_notes",
              label: notes.length > 120 ? `${notes.slice(0, 117)}…` : notes,
              status: "included",
            },
          ]
        : [];
      sections.push({
        id,
        label: SECTION_LABELS[id],
        status: items.length === 0 ? "unavailable" : "complete",
        includedCount: items.length,
        missingCount: 0,
        needsAttentionCount: 0,
        items,
      });
      continue;
    }
    const groupIds = documentSectionMap[id];
    const result = gatherDocumentItemsByGroupIds(input.documents, groupIds);
    sections.push({
      id,
      label: SECTION_LABELS[id],
      status: deriveSectionStatus({
        included: result.included,
        missing: result.missing,
        needsAttention: result.needsAttention,
        totalKnown: result.items.length,
      }),
      includedCount: result.included,
      missingCount: result.missing,
      needsAttentionCount: result.needsAttention,
      items: result.items,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Clarifications
// ---------------------------------------------------------------------------

function buildClarifications(
  input: SubmissionOrchestrationInput,
): SubmissionClarificationItem[] {
  const list: SubmissionClarificationItem[] = [];
  const seenLabels = new Set<string>();

  function add(c: SubmissionClarificationItem) {
    const key = c.label.toLowerCase();
    if (seenLabels.has(key)) return;
    seenLabels.add(key);
    list.push(c);
  }

  // 1. Document needs_attention items
  for (const group of input.documents.groups) {
    for (const req of group.requirements) {
      if (req.status === "needs_attention") {
        const item: SubmissionClarificationItem = {
          id: `doc_${req.id}`,
          label: req.label,
          reason:
            req.recoveryMessage ??
            "Borrower upload may need a clearer copy or full pages.",
          status: "open",
          priority: "required",
          source: "document",
        };
        const href = trimOrNull(req.href ?? null) ?? undefined;
        if (href) item.href = href;
        add(item);
      }
    }
  }

  // 2. Communication response-needed items
  for (const r of input.communication.responseNeededItems) {
    const item: SubmissionClarificationItem = {
      id: `comm_${r.id}`,
      label: r.label,
      reason: r.reason,
      status: "open",
      priority: r.priority,
      source: "communication",
    };
    const href = trimOrNull(r.href ?? null) ?? undefined;
    if (href) item.href = href;
    add(item);
  }

  // 3. Submission attention items
  for (const a of input.submission.attentionItems) {
    if (a.priority === "optional") continue;
    const item: SubmissionClarificationItem = {
      id: `sub_${a.id}`,
      label: a.label,
      reason: a.description ?? "Flagged before submission preparation.",
      status: a.priority === "required" ? "open" : "needs_review",
      priority: a.priority,
      source: "submission_prep",
    };
    const href = trimOrNull(a.href ?? null) ?? undefined;
    if (href) item.href = href;
    add(item);
  }

  // 4. Trust review confirmation items still needing confirmation
  for (const c of input.trustReview.confirmationItems) {
    if (c.status === "needs_confirmation") {
      const item: SubmissionClarificationItem = {
        id: `trust_${c.id}`,
        label: c.label,
        reason: c.description,
        status: "needs_review",
        priority: "helpful",
        source: "banker_review",
      };
      const href = trimOrNull(c.href ?? null) ?? undefined;
      if (href) item.href = href;
      add(item);
    }
  }

  // 5. Guidance friction signals (banker-operational translation)
  const FRICTION_TO_BANKER: Partial<
    Record<string, { label: string; reason: string; priority: "required" | "helpful" }>
  > = {
    needs_clarification: {
      label: "Borrower clarification needed",
      reason: "Borrower experience indicates clarification is needed before proceeding.",
      priority: "required",
    },
    blocked: {
      label: "Borrower experience surfaced a block",
      reason: "Resolve the borrower block before continuing submission preparation.",
      priority: "required",
    },
    waiting_for_review: {
      label: "Borrower is awaiting a review pass",
      reason: "Banker review may help unblock the borrower's next step.",
      priority: "helpful",
    },
  };
  // Use submission's friction signals as the bridge (already deterministic).
  for (const signal of input.submission.frictionSignals) {
    const map = FRICTION_TO_BANKER[signal as keyof typeof FRICTION_TO_BANKER];
    if (!map) continue;
    add({
      id: `friction_${signal}`,
      label: map.label,
      reason: map.reason,
      status: "open",
      priority: map.priority,
      source: "guidance",
    });
  }

  // Deterministic sort: priority then source then label
  const PRIORITY_RANK = { required: 0, helpful: 1, optional: 2 };
  const SOURCE_RANK = {
    document: 0,
    communication: 1,
    submission_prep: 2,
    guidance: 3,
    banker_review: 4,
  };
  list.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pa !== 0) return pa;
    const sa = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (sa !== 0) return sa;
    return a.label.localeCompare(b.label);
  });

  return list;
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

function deriveNextAction(
  input: SubmissionOrchestrationInput,
  state: SubmissionOrchestrationState,
  gates: SubmissionReadinessGate[],
  clarifications: SubmissionClarificationItem[],
): SubmissionOrchestrationNextAction {
  const prepareHref = trimOrNull(input.prepareSubmissionHref) ?? undefined;
  const reviewHref = trimOrNull(input.reviewPackageHref) ?? undefined;
  const resolveHref = trimOrNull(input.resolveClarificationsHref) ?? undefined;
  const requestHref = trimOrNull(input.requestDocumentsHref) ?? undefined;

  if (state === "submitted") {
    return {
      id: "no_action_available",
      label: "No action available",
      rationale: "Submission preparation has been marked complete.",
      urgency: "low",
    };
  }

  if (state === "submission_in_progress") {
    const action: SubmissionOrchestrationNextAction = {
      id: "monitor_submission_progress",
      label: "Monitor submission progress",
      rationale: "Submission preparation is in progress — keep an eye on it.",
      urgency: "normal",
    };
    if (prepareHref) action.href = prepareHref;
    return action;
  }

  if (state === "ready_for_submission") {
    const action: SubmissionOrchestrationNextAction = {
      id: "prepare_lender_submission",
      label: "Prepare lender submission",
      rationale: "All blocking gates passed — open the submission preparation surface.",
      urgency: "high",
    };
    if (prepareHref) action.href = prepareHref;
    return action;
  }

  if (state === "awaiting_clarifications") {
    const action: SubmissionOrchestrationNextAction = {
      id: "resolve_clarifications",
      label: "Resolve clarifications",
      rationale:
        clarifications.length > 0
          ? `${clarifications.length} clarification item${clarifications.length === 1 ? "" : "s"} open before review continues.`
          : "Outstanding borrower clarification is blocking review.",
      urgency: "high",
    };
    if (resolveHref) action.href = resolveHref;
    return action;
  }

  if (state === "preparing_package") {
    const missing = countStrictlyMissingRequired(input.documents);
    if (missing > 0) {
      const action: SubmissionOrchestrationNextAction = {
        id: "request_missing_items",
        label: "Request missing items",
        rationale: `${missing} required item${missing === 1 ? "" : "s"} still needed from the borrower.`,
        urgency: missing >= 3 ? "high" : "normal",
      };
      if (requestHref) action.href = requestHref;
      return action;
    }
    const action: SubmissionOrchestrationNextAction = {
      id: "review_readiness_gates",
      label: "Review readiness gates",
      rationale: "Package is being assembled — review the readiness gates to keep momentum.",
      urgency: "low",
    };
    if (reviewHref) action.href = reviewHref;
    return action;
  }

  if (state === "package_review") {
    // Determine whether package inventory needs review first, then banker submission review
    const inventoryGate = gates.find(
      (g) => g.id === "package_inventory_reviewed",
    );
    if (inventoryGate?.status === "needs_review") {
      const action: SubmissionOrchestrationNextAction = {
        id: "review_package_inventory",
        label: "Review package inventory",
        rationale: "Banker has not yet reviewed the assembled package inventory.",
        urgency: "high",
      };
      if (reviewHref) action.href = reviewHref;
      return action;
    }
    const action: SubmissionOrchestrationNextAction = {
      id: "complete_banker_review",
      label: "Complete banker submission review",
      rationale: "Final banker submission review remains before the package is ready.",
      urgency: "high",
    };
    if (reviewHref) action.href = reviewHref;
    return action;
  }

  // state === "not_started"
  return {
    id: "no_action_available",
    label: "No action available",
    rationale: "Submission orchestration cannot begin until the document list is published.",
    urgency: "low",
  };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function buildTimeline(
  input: SubmissionOrchestrationInput,
): SubmissionOrchestrationTimelineEvent[] {
  const cap = Math.max(0, input.maxTimelineEvents ?? 6);
  if (cap === 0) return [];
  const events: SubmissionOrchestrationTimelineEvent[] = [];

  // 1. Real activity events
  for (const a of input.activity ?? []) {
    const label = trimOrNull(a.label);
    if (!label) continue;
    const timestamp = trimOrNull(a.timestamp ?? null) ?? undefined;
    const event: SubmissionOrchestrationTimelineEvent = {
      id: `activity_${a.id}`,
      label,
      category: a.category,
    };
    if (timestamp) event.timestamp = timestamp;
    events.push(event);
  }

  // 2. Banker review milestones from persisted state
  const inv = trimOrNull(input.bankerReview?.packageInventoryReviewedAt ?? null);
  if (inv) {
    events.push({
      id: "br_inventory",
      label: "Banker reviewed package inventory",
      timestamp: inv,
      category: "banker_review",
    });
  }
  const sub = trimOrNull(input.bankerReview?.submissionReviewCompletedAt ?? null);
  if (sub) {
    events.push({
      id: "br_submission",
      label: "Banker completed submission review",
      timestamp: sub,
      category: "banker_review",
    });
  }

  // 3. Submission state milestones
  const started = trimOrNull(input.submissionState?.submissionStartedAt ?? null);
  if (started) {
    events.push({
      id: "sub_started",
      label: "Submission preparation started",
      timestamp: started,
      category: "submission",
    });
  }
  const submitted = trimOrNull(input.submissionState?.submittedAt ?? null);
  if (submitted) {
    events.push({
      id: "sub_submitted",
      label: "Submission preparation marked complete",
      timestamp: submitted,
      category: "submission",
    });
  }

  // Sort: dated newest-first, then undated
  const dated = events.filter((e) => typeof e.timestamp === "string");
  const undated = events.filter((e) => typeof e.timestamp !== "string");
  dated.sort((a, b) =>
    a.timestamp! < b.timestamp! ? 1 : a.timestamp! > b.timestamp! ? -1 : 0,
  );

  // De-dup by label+timestamp
  const seen = new Set<string>();
  const merged: SubmissionOrchestrationTimelineEvent[] = [];
  for (const e of [...dated, ...undated]) {
    const key = `${e.label}|${e.timestamp ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
    if (merged.length >= cap) break;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildSubmissionOrchestrationViewModel(
  input: SubmissionOrchestrationInput,
): SubmissionOrchestrationViewModel {
  const clarifications = buildClarifications(input);
  const gates = buildGates(input);
  const state = deriveState(input, gates);
  const packageSections = buildPackageSections(input, clarifications);
  const nextAction = deriveNextAction(input, state, gates, clarifications);
  const timeline = buildTimeline(input);

  return {
    state,
    headline: STATE_HEADLINES[state],
    summary: buildSummary(input, state),
    gates,
    packageSections,
    clarifications,
    nextAction,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Public labels (used by UI + tests)
// ---------------------------------------------------------------------------

export const SUBMISSION_ORCHESTRATION_STATE_LABELS: Record<
  SubmissionOrchestrationState,
  string
> = {
  not_started: "Not started",
  preparing_package: "Preparing package",
  awaiting_clarifications: "Awaiting clarifications",
  package_review: "Package review",
  ready_for_submission: "Ready for submission",
  submission_in_progress: "Submission in progress",
  submitted: "Submission marked complete",
};

export const SUBMISSION_GATE_STATUS_LABELS: Record<SubmissionGateStatus, string> = {
  passed: "Passed",
  blocked: "Blocked",
  needs_review: "Needs review",
  not_applicable: "Not applicable",
  unavailable: "Unavailable",
};

export const SUBMISSION_PACKAGE_SECTION_STATUS_LABELS: Record<
  SubmissionPackageSectionStatus,
  string
> = {
  complete: "Complete",
  partial: "Partial",
  needs_attention: "Needs attention",
  unavailable: "Unavailable",
};

export const SUBMISSION_CLARIFICATION_STATUS_LABELS: Record<
  SubmissionClarificationStatus,
  string
> = {
  open: "Open",
  needs_review: "Needs review",
  resolved: "Resolved",
  unavailable: "Unavailable",
};
