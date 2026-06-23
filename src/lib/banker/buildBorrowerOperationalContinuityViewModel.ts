/**
 * Borrower-to-Banker Operational Continuity — View Model Builder
 *
 * Deterministic, pure-function synthesizer that translates the borrower-side
 * intelligence layer (journey, readiness, deal health, guidance, documents,
 * communication, mobile command, submission readiness, trust review) into
 * banker-operational continuity: a single handoff state, an intake brief,
 * a next-best banker action, momentum signals, continuity cards, and a
 * compact recent-events timeline.
 *
 * Spec: 15N / Spec 10 — Borrower-to-Banker Operational Continuity
 *
 * Rules:
 * - Pure function, no DB or network calls
 * - Banker-operational copy only — never reuses borrower-facing reassurance
 *   verbatim, never invents banker notes or activity
 * - Real state only — no fake timestamps, no AI freeform, no approval claims
 * - Deterministic ordering for testability
 * - Safe fallback for minimal/empty borrower state
 */

import type { BorrowerJourneyViewModel } from "@/lib/borrower/buildBorrowerJourneyViewModel";
import type { BorrowerReadinessViewModel } from "@/lib/borrower/buildBorrowerReadinessViewModel";
import type { BorrowerDealHealthViewModel } from "@/lib/borrower/buildBorrowerDealHealthViewModel";
import type { BorrowerGuidanceViewModel } from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import type { BorrowerDocumentExperienceViewModel } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import type { BorrowerCommunicationViewModel } from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import type { BorrowerMobileCommandViewModel } from "@/lib/borrower/buildBorrowerMobileCommandViewModel";
import type { BorrowerSubmissionReadinessViewModel } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";
import type { BorrowerTrustReviewViewModel } from "@/lib/borrower/buildBorrowerTrustReviewViewModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerOperationalHandoffState =
  | "borrower_starting"
  | "borrower_active"
  | "borrower_blocked"
  | "waiting_on_borrower"
  | "waiting_on_banker"
  | "ready_for_banker_review"
  | "ready_for_submission_prep"
  | "needs_clarification";

export type BankerNextBestActionId =
  | "review_borrower_package"
  | "request_missing_documents"
  | "resolve_attention_items"
  | "review_confirmations"
  | "prepare_submission_package"
  | "send_reassurance_update"
  | "wait_for_borrower"
  | "no_action_needed";

export type BankerNextBestActionUrgency = "low" | "normal" | "high";

export type BankerNextBestAction = {
  id: BankerNextBestActionId;
  label: string;
  rationale: string;
  urgency: BankerNextBestActionUrgency;
  href?: string;
};

export type BorrowerMomentumSignals = {
  requiredDocumentsReceived: number;
  requiredDocumentsRemaining: number;
  needsAttentionCount: number;
  borrowerActionNeededCount: number;
  recentActivityCount: number;
  waitingOnLabel: string;
  submissionReadinessLabel: string;
  trustReviewLabel: string;
  lastBorrowerActivityAt?: string;
};

export type BankerContinuityCardStatus =
  | "strong"
  | "progressing"
  | "needs_attention"
  | "blocked"
  | "waiting"
  | "ready"
  | "unavailable";

export type BankerContinuityCard = {
  id: string;
  title: string;
  status: BankerContinuityCardStatus;
  summary: string;
  count?: number;
  ctaLabel?: string;
  href?: string;
};

export type BankerOperationalTimelineEventCategory =
  | "document"
  | "borrower_action"
  | "banker_action"
  | "review"
  | "submission"
  | "communication";

export type BankerOperationalTimelineEvent = {
  id: string;
  label: string;
  description?: string;
  timestamp?: string;
  category: BankerOperationalTimelineEventCategory;
};

export type BorrowerOperationalContinuityViewModel = {
  handoffState: BorrowerOperationalHandoffState;
  headline: string;
  summary: string;
  waitingOnLabel: string;
  nextBestAction: BankerNextBestAction;
  momentum: BorrowerMomentumSignals;
  cards: BankerContinuityCard[];
  recentEvents: BankerOperationalTimelineEvent[];
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type OperationalContinuityActivityEvent = {
  id: string;
  label: string;
  description?: string | null;
  timestamp?: string | null;
  category:
    | "upload"
    | "review"
    | "verification"
    | "milestone"
    | "request"
    | "communication";
};

export type BorrowerOperationalContinuityInput = {
  dealId: string;
  borrowerName?: string | null;
  businessName?: string | null;
  journey: BorrowerJourneyViewModel;
  readiness?: BorrowerReadinessViewModel;
  dealHealth?: BorrowerDealHealthViewModel;
  guidance: BorrowerGuidanceViewModel;
  documents: BorrowerDocumentExperienceViewModel;
  communication: BorrowerCommunicationViewModel;
  mobileCommand?: BorrowerMobileCommandViewModel;
  submission: BorrowerSubmissionReadinessViewModel;
  trustReview: BorrowerTrustReviewViewModel;
  /** Optional real activity events. No timestamps will be fabricated. */
  activity?: OperationalContinuityActivityEvent[];
  /** Optional known banker route href, e.g. /banker/deals/{dealId}/discovery */
  bankerWorkspaceHref?: string | null;
  /** Optional href for requesting borrower documents */
  requestDocumentsHref?: string | null;
  /** Optional href for opening the submission preparation surface */
  submissionPrepHref?: string | null;
  /** Optional href for opening a reassurance/messaging surface */
  borrowerMessageHref?: string | null;
  /** Max recent events surfaced. Default 5. */
  maxRecentEvents?: number;
};

// ---------------------------------------------------------------------------
// Small helpers
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

// ---------------------------------------------------------------------------
// Handoff state derivation
// ---------------------------------------------------------------------------

function deriveHandoffState(
  input: BorrowerOperationalContinuityInput,
): BorrowerOperationalHandoffState {
  const pkg = input.documents.packageSummary;
  const commState = input.communication.state;
  const trustState = input.trustReview.state;
  const subBand = input.submission.band;
  const missingRequired = countStrictlyMissingRequired(input.documents);
  const portalStage = input.journey.currentStage;

  if (commState === "blocked") return "borrower_blocked";

  // True zero state: no documents tracked AND borrower is at the very start.
  // This must precede the submission-band check, because a zero-doc package
  // technically passes "all required received" trivially.
  if (
    pkg.requiredTotal === 0 &&
    pkg.requiredReceived === 0 &&
    (portalStage === "started_application" ||
      portalStage === "business_profile" ||
      input.journey.progressPercent <= 5)
  ) {
    return "borrower_starting";
  }

  if (pkg.requiredReceived === 0 && pkg.requiredTotal > 0) {
    return "borrower_starting";
  }

  if (subBand === "submission_preparation_ready" && pkg.requiredReceived > 0) {
    return "ready_for_submission_prep";
  }

  if (input.communication.waitingOn === "clarification") {
    return "needs_clarification";
  }

  if (
    commState === "waiting_on_review" ||
    input.communication.waitingOn === "buddy_review" ||
    input.communication.waitingOn === "banker_review"
  ) {
    if (subBand === "near_submission_preparation" || pkg.requiredRemaining === 0) {
      return "ready_for_banker_review";
    }
    return "waiting_on_banker";
  }

  if (missingRequired > 0 || pkg.needsAttention > 0) {
    return "waiting_on_borrower";
  }

  if (trustState === "ready_to_review" || trustState === "confirmations_needed") {
    return "ready_for_banker_review";
  }

  return "borrower_active";
}

// ---------------------------------------------------------------------------
// Headline / summary (banker-operational; not borrower copy reused verbatim)
// ---------------------------------------------------------------------------

const HEADLINES: Record<BorrowerOperationalHandoffState, string> = {
  borrower_starting:
    "Borrower is at the start of the document gathering process.",
  borrower_active: "Borrower is actively progressing through the package.",
  borrower_blocked:
    "Borrower has a critical block preventing further progress.",
  waiting_on_borrower:
    "Borrower has outstanding items before the package can move forward.",
  waiting_on_banker:
    "Package is queued for banker or Buddy review.",
  ready_for_banker_review:
    "Package is ready for banker review of the borrower-supplied content.",
  ready_for_submission_prep:
    "Borrower-supplied content appears complete — submission preparation can begin.",
  needs_clarification:
    "Borrower-supplied content needs clarification before review continues.",
};

function buildSummary(
  input: BorrowerOperationalContinuityInput,
  state: BorrowerOperationalHandoffState,
): string {
  const pkg = input.documents.packageSummary;
  const remaining = pkg.requiredRemaining;
  const attention = pkg.needsAttention;
  const received = pkg.requiredReceived;
  const total = pkg.requiredTotal;

  switch (state) {
    case "borrower_starting":
      return total > 0
        ? `No required items received yet (0 of ${total}).`
        : "Document request list is being prepared for the borrower.";
    case "borrower_active":
      return `Borrower has supplied ${received} of ${total} required items.`;
    case "borrower_blocked":
      return "Borrower experience is showing a critical block. Review communication and outstanding items.";
    case "waiting_on_borrower":
      if (remaining > 0 && attention > 0) {
        return `${remaining} required item${remaining === 1 ? "" : "s"} still missing and ${attention} flagged for attention.`;
      }
      if (remaining > 0) {
        return `${remaining} required item${remaining === 1 ? "" : "s"} still needed from the borrower.`;
      }
      return `${attention} item${attention === 1 ? "" : "s"} flagged for borrower follow-up.`;
    case "waiting_on_banker":
      return `Borrower has supplied ${received} of ${total} required items and is waiting on review.`;
    case "ready_for_banker_review":
      return total > 0
        ? `All required items appear to be received (${received} of ${total}). Borrower review surface is open.`
        : "Borrower review surface is open for review.";
    case "ready_for_submission_prep":
      return "Required items received and submission readiness signals are positive.";
    case "needs_clarification":
      return "One or more borrower documents need clarification before continuing.";
  }
}

// ---------------------------------------------------------------------------
// Waiting-on label (banker translation)
// ---------------------------------------------------------------------------

const WAITING_ON_BANKER_LABELS: Record<string, string> = {
  borrower: "Waiting on borrower",
  buddy_review: "Queued for review",
  banker_review: "Queued for banker review",
  clarification: "Awaiting borrower clarification",
  next_review_step: "Preparing next step",
  unknown: "No active wait",
};

function deriveWaitingOnLabel(
  input: BorrowerOperationalContinuityInput,
  state: BorrowerOperationalHandoffState,
): string {
  if (
    state === "ready_for_banker_review" ||
    state === "waiting_on_banker" ||
    state === "ready_for_submission_prep"
  ) {
    return "Waiting on banker";
  }
  const fallback = WAITING_ON_BANKER_LABELS[input.communication.waitingOn];
  if (fallback) return fallback;
  return "No active wait";
}

// ---------------------------------------------------------------------------
// Next best banker action
// ---------------------------------------------------------------------------

function deriveNextBestAction(
  input: BorrowerOperationalContinuityInput,
  state: BorrowerOperationalHandoffState,
): BankerNextBestAction {
  const pkg = input.documents.packageSummary;
  const missingRequired = countStrictlyMissingRequired(input.documents);
  const attention = pkg.needsAttention;
  const bankerHref = trimOrNull(input.bankerWorkspaceHref) ?? undefined;
  const requestHref = trimOrNull(input.requestDocumentsHref) ?? undefined;
  const submissionHref = trimOrNull(input.submissionPrepHref) ?? undefined;
  const messageHref = trimOrNull(input.borrowerMessageHref) ?? undefined;

  switch (state) {
    case "ready_for_submission_prep": {
      const action: BankerNextBestAction = {
        id: "prepare_submission_package",
        label: "Prepare submission package",
        rationale:
          "Required items have been received. Buddy can stage the lender package for submission preparation.",
        urgency: "high",
      };
      if (submissionHref) action.href = submissionHref;
      else if (bankerHref) action.href = bankerHref;
      return action;
    }
    case "ready_for_banker_review": {
      const action: BankerNextBestAction = {
        id: "review_borrower_package",
        label: "Review borrower package",
        rationale:
          "The borrower-supplied content is ready for a banker review pass before submission preparation.",
        urgency: "high",
      };
      if (bankerHref) action.href = bankerHref;
      return action;
    }
    case "needs_clarification": {
      const action: BankerNextBestAction = {
        id: "resolve_attention_items",
        label: "Resolve clarification items",
        rationale:
          attention > 0
            ? `${attention} document${attention === 1 ? "" : "s"} need a closer look before continuing.`
            : "One or more borrower-supplied items need clarification.",
        urgency: "high",
      };
      if (bankerHref) action.href = bankerHref;
      return action;
    }
    case "waiting_on_borrower": {
      if (missingRequired > 0) {
        const action: BankerNextBestAction = {
          id: "request_missing_documents",
          label: "Request missing documents",
          rationale: `${missingRequired} required item${missingRequired === 1 ? "" : "s"} still missing from the borrower.`,
          urgency: missingRequired >= 3 ? "high" : "normal",
        };
        if (requestHref) action.href = requestHref;
        else if (messageHref) action.href = messageHref;
        return action;
      }
      const action: BankerNextBestAction = {
        id: "resolve_attention_items",
        label: "Resolve attention items",
        rationale: `${attention} item${attention === 1 ? "" : "s"} flagged for follow-up on the borrower side.`,
        urgency: "normal",
      };
      if (bankerHref) action.href = bankerHref;
      return action;
    }
    case "borrower_blocked": {
      const action: BankerNextBestAction = {
        id: "send_reassurance_update",
        label: "Reach out to the borrower",
        rationale:
          "The borrower experience indicates a critical block. A check-in may help unblock progress.",
        urgency: "high",
      };
      if (messageHref) action.href = messageHref;
      else if (bankerHref) action.href = bankerHref;
      return action;
    }
    case "borrower_starting":
      return {
        id: "wait_for_borrower",
        label: "Wait for borrower to start uploading",
        rationale:
          "Borrower is at the start of the process. No banker action is needed until documents begin arriving.",
        urgency: "low",
      };
    case "borrower_active":
      return {
        id: "wait_for_borrower",
        label: "Let the borrower continue",
        rationale:
          "Borrower is progressing through the document list. Banker can wait until items arrive.",
        urgency: "low",
      };
    case "waiting_on_banker": {
      const action: BankerNextBestAction = {
        id: "review_borrower_package",
        label: "Review borrower package",
        rationale:
          "Borrower is waiting on a review pass. Open the deal workspace to continue.",
        urgency: "normal",
      };
      if (bankerHref) action.href = bankerHref;
      return action;
    }
  }
}

// ---------------------------------------------------------------------------
// Momentum signals
// ---------------------------------------------------------------------------

function buildMomentum(
  input: BorrowerOperationalContinuityInput,
): BorrowerMomentumSignals {
  const pkg = input.documents.packageSummary;
  const realActivity = (input.activity ?? []).filter(
    (e) => typeof e.id === "string" && e.id.length > 0,
  );
  const lastActivityTimestamp = realActivity
    .map((e) => trimOrNull(e.timestamp))
    .filter((t): t is string => t !== null)
    .sort()
    .reverse()[0];

  const momentum: BorrowerMomentumSignals = {
    requiredDocumentsReceived: pkg.requiredReceived,
    requiredDocumentsRemaining: pkg.requiredRemaining,
    needsAttentionCount: pkg.needsAttention,
    borrowerActionNeededCount: input.communication.actionNeededCount,
    recentActivityCount: realActivity.length,
    waitingOnLabel: input.communication.waitingOnLabel,
    submissionReadinessLabel: input.submission.bandLabel,
    trustReviewLabel: trustReviewLabelOf(input.trustReview.state),
  };
  if (lastActivityTimestamp) {
    momentum.lastBorrowerActivityAt = lastActivityTimestamp;
  }
  return momentum;
}

function trustReviewLabelOf(state: BorrowerTrustReviewViewModel["state"]): string {
  switch (state) {
    case "not_ready_to_review":
      return "Not ready for review yet";
    case "ready_to_review":
      return "Ready to review";
    case "confirmations_needed":
      return "Confirm a few details";
    case "reviewed":
      return "Review saved";
    case "waiting_on_updates":
      return "Waiting on updates";
  }
}

// ---------------------------------------------------------------------------
// Continuity cards
// ---------------------------------------------------------------------------

function buildCards(
  input: BorrowerOperationalContinuityInput,
  state: BorrowerOperationalHandoffState,
): BankerContinuityCard[] {
  const pkg = input.documents.packageSummary;
  const missingRequired = countStrictlyMissingRequired(input.documents);
  const cards: BankerContinuityCard[] = [];

  // 1. Package readiness
  const readinessPct = input.submission.readinessPercent;
  const packageStatus: BankerContinuityCardStatus =
    pkg.requiredTotal === 0
      ? "unavailable"
      : input.submission.band === "submission_preparation_ready"
        ? "ready"
        : input.submission.band === "near_submission_preparation"
          ? "progressing"
          : pkg.requiredReceived === 0
            ? "needs_attention"
            : "progressing";
  cards.push({
    id: "package_readiness",
    title: "Package readiness",
    status: packageStatus,
    summary:
      readinessPct !== undefined
        ? `${readinessPct}% of required items received (${pkg.requiredReceived} of ${pkg.requiredTotal}).`
        : "No required items requested yet.",
    count: pkg.requiredReceived,
  });

  // 2. Borrower action needed
  const borrowerActions = input.communication.actionNeededCount;
  cards.push({
    id: "borrower_action_needed",
    title: "Borrower action needed",
    status:
      borrowerActions === 0
        ? "ready"
        : borrowerActions >= 3
          ? "needs_attention"
          : "waiting",
    summary:
      borrowerActions === 0
        ? "Borrower is not currently being asked for additional action."
        : `${borrowerActions} item${borrowerActions === 1 ? "" : "s"} await borrower response.`,
    count: borrowerActions,
  });

  // 3. Banker action needed
  const bankerWaiting =
    state === "ready_for_banker_review" ||
    state === "waiting_on_banker" ||
    state === "needs_clarification" ||
    state === "ready_for_submission_prep" ||
    state === "borrower_blocked";
  cards.push({
    id: "banker_action_needed",
    title: "Banker action needed",
    status: bankerWaiting ? "needs_attention" : "ready",
    summary: bankerWaiting
      ? "Banker review or follow-up will help move this deal forward."
      : "No banker action required right now.",
  });

  // 4. Documents & attention
  cards.push({
    id: "documents_attention",
    title: "Documents & attention",
    status:
      pkg.needsAttention > 0
        ? "needs_attention"
        : missingRequired > 0
          ? "waiting"
          : "ready",
    summary:
      pkg.needsAttention === 0 && missingRequired === 0
        ? "No documents currently flagged or missing on the borrower side."
        : `${missingRequired} missing required, ${pkg.needsAttention} flagged for attention.`,
    count: missingRequired + pkg.needsAttention,
  });

  // 5. Submission preparation
  cards.push({
    id: "submission_preparation",
    title: "Submission preparation",
    status:
      input.submission.band === "submission_preparation_ready"
        ? "ready"
        : input.submission.band === "near_submission_preparation"
          ? "progressing"
          : input.submission.band === "progressing"
            ? "progressing"
            : "waiting",
    summary: input.submission.bandLabel,
  });

  // 6. Trust review
  const trustStatus: BankerContinuityCardStatus = (() => {
    switch (input.trustReview.state) {
      case "ready_to_review":
        return "ready";
      case "confirmations_needed":
        return "needs_attention";
      case "reviewed":
        return "strong";
      case "waiting_on_updates":
        return "waiting";
      case "not_ready_to_review":
        return "unavailable";
    }
  })();
  cards.push({
    id: "trust_review",
    title: "Trust review",
    status: trustStatus,
    summary: trustReviewLabelOf(input.trustReview.state),
  });

  return cards;
}

// ---------------------------------------------------------------------------
// Recent events (translated to banker-operational copy)
// ---------------------------------------------------------------------------

// "no_action_needed" is a synthetic state update from the communication VM
// and isn't a banker-relevant event, so it's intentionally not mapped here.
const COMMUNICATION_UPDATE_TO_OPERATIONAL: Record<
  string,
  { label: string; category: BankerOperationalTimelineEventCategory }
> = {
  document_received: { label: "Borrower upload received", category: "document" },
  document_needs_attention: {
    label: "Document flagged for attention",
    category: "document",
  },
  milestone_completed: { label: "Borrower reached a milestone", category: "review" },
  guidance_updated: { label: "Borrower guidance refreshed", category: "communication" },
  recommendation_added: {
    label: "New borrower recommendation surfaced",
    category: "communication",
  },
  blocker_added: { label: "New blocker raised", category: "borrower_action" },
  blocker_resolved: { label: "Blocker resolved", category: "borrower_action" },
  review_started: { label: "Review pass started", category: "review" },
};

function buildRecentEvents(
  input: BorrowerOperationalContinuityInput,
): BankerOperationalTimelineEvent[] {
  const cap = Math.max(0, input.maxRecentEvents ?? 5);
  if (cap === 0) return [];

  const events: BankerOperationalTimelineEvent[] = [];

  // 1. Real activity events (highest signal)
  for (const event of input.activity ?? []) {
    const label = trimOrNull(event.label);
    if (!label) continue;
    const category: BankerOperationalTimelineEventCategory =
      event.category === "upload"
        ? "document"
        : event.category === "review"
          ? "review"
          : event.category === "communication"
            ? "communication"
            : event.category === "milestone"
              ? "review"
              : event.category === "verification"
                ? "review"
                : "borrower_action";
    const timestamp = trimOrNull(event.timestamp) ?? undefined;
    const description = trimOrNull(event.description) ?? undefined;
    const e: BankerOperationalTimelineEvent = {
      id: `activity_${event.id}`,
      label,
      category,
    };
    if (timestamp) e.timestamp = timestamp;
    if (description) e.description = description;
    events.push(e);
  }

  // 2. Recent communication updates (already deduped and ordered by VM)
  for (const update of input.communication.recentUpdates) {
    const mapping = COMMUNICATION_UPDATE_TO_OPERATIONAL[update.type];
    if (!mapping) continue;
    const e: BankerOperationalTimelineEvent = {
      id: `comm_${update.id}`,
      label: mapping.label,
      category: mapping.category,
    };
    const timestamp = trimOrNull(update.timestamp ?? null) ?? undefined;
    if (timestamp) e.timestamp = timestamp;
    const description = trimOrNull(update.description ?? null) ?? undefined;
    if (description) e.description = description;
    events.push(e);
  }

  // Deterministic ordering:
  //   - events with timestamps newest first
  //   - then events without timestamps in insertion order
  const dated = events.filter((e) => typeof e.timestamp === "string");
  const undated = events.filter((e) => typeof e.timestamp !== "string");
  dated.sort((a, b) => (a.timestamp! < b.timestamp! ? 1 : a.timestamp! > b.timestamp! ? -1 : 0));

  // De-duplicate by label+timestamp to avoid double-emitting the same event
  const seen = new Set<string>();
  const merged: BankerOperationalTimelineEvent[] = [];
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

export function buildBorrowerOperationalContinuityViewModel(
  input: BorrowerOperationalContinuityInput,
): BorrowerOperationalContinuityViewModel {
  const handoffState = deriveHandoffState(input);
  const headline = HEADLINES[handoffState];
  const summary = buildSummary(input, handoffState);
  const waitingOnLabel = deriveWaitingOnLabel(input, handoffState);
  const nextBestAction = deriveNextBestAction(input, handoffState);
  const momentum = buildMomentum(input);
  const cards = buildCards(input, handoffState);
  const recentEvents = buildRecentEvents(input);

  return {
    handoffState,
    headline,
    summary,
    waitingOnLabel,
    nextBestAction,
    momentum,
    cards,
    recentEvents,
  };
}

// ---------------------------------------------------------------------------
// Public state-label helpers (used by UI + tests)
// ---------------------------------------------------------------------------

export const BORROWER_OPERATIONAL_HANDOFF_STATE_LABELS: Record<
  BorrowerOperationalHandoffState,
  string
> = {
  borrower_starting: "Borrower starting",
  borrower_active: "Borrower active",
  borrower_blocked: "Borrower blocked",
  waiting_on_borrower: "Waiting on borrower",
  waiting_on_banker: "Waiting on banker",
  ready_for_banker_review: "Ready for banker review",
  ready_for_submission_prep: "Ready for submission preparation",
  needs_clarification: "Needs clarification",
};

export const BANKER_CONTINUITY_CARD_STATUS_LABELS: Record<
  BankerContinuityCardStatus,
  string
> = {
  strong: "Strong",
  progressing: "Progressing",
  needs_attention: "Needs attention",
  blocked: "Blocked",
  waiting: "Waiting",
  ready: "Ready",
  unavailable: "Unavailable",
};
