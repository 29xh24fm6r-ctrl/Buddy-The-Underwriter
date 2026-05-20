/**
 * Borrower Communication & Reassurance — View Model Builder
 *
 * Deterministic, pure-function layer that turns real portal/deal/activity
 * state into a borrower-safe "Messages & Updates" experience. No fake
 * banker messages, no AI freeform, no invented timestamps.
 *
 * Spec: 15J / Spec 6 — Borrower Communication & Reassurance System
 *
 * Rules:
 * - Pure function, no DB or network calls
 * - Borrower-safe plain English only — no internal enums or status leakage
 * - Never invent timestamps; only surface what real state provides
 * - Deterministic ordering for testability
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerCommunicationState =
  | "action_needed"
  | "waiting_on_review"
  | "no_action_needed"
  | "update_available"
  | "blocked";

export type BorrowerWaitingOn =
  | "borrower"
  | "buddy_review"
  | "banker_review"
  | "clarification"
  | "next_review_step"
  | "unknown";

export type BorrowerCommunicationUpdateType =
  | "document_received"
  | "document_needs_attention"
  | "milestone_completed"
  | "guidance_updated"
  | "recommendation_added"
  | "blocker_added"
  | "blocker_resolved"
  | "review_started"
  | "no_action_needed";

export type BorrowerCommunicationUpdate = {
  id: string;
  label: string;
  description?: string;
  timestamp?: string;
  type: BorrowerCommunicationUpdateType;
};

export type BorrowerResponseNeededItem = {
  id: string;
  label: string;
  reason: string;
  priority: "required" | "helpful" | "optional";
  href?: string;
};

export type BorrowerCommunicationViewModel = {
  state: BorrowerCommunicationState;
  headline: string;
  summary: string;
  waitingOn: BorrowerWaitingOn;
  waitingOnLabel: string;
  actionNeededCount: number;
  responseNeededItems: BorrowerResponseNeededItem[];
  recentUpdates: BorrowerCommunicationUpdate[];
  reassuranceMessage?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type CommunicationActivityEvent = {
  id: string;
  label: string;
  timestamp?: string | null;
  category: "upload" | "review" | "verification" | "milestone" | "request";
};

export type CommunicationBlocker = {
  id: string;
  label: string;
  reason?: string;
  severity?: "critical" | "standard";
  href?: string;
};

export type CommunicationDocItem = {
  id: string;
  label: string;
  status:
    | "missing"
    | "uploaded"
    | "received"
    | "reviewing"
    | "accepted"
    | "needs_attention"
    | "optional"
    | "unavailable";
  required: boolean;
  href?: string;
};

export type CommunicationRecommendation = {
  id: string;
  label: string;
  explanation?: string;
  priority: "high" | "medium" | "low";
  href?: string;
};

export type CommunicationGuidanceNextStep = {
  headline: string;
  description?: string;
  ctaLabel?: string;
  href?: string;
};

export type CommunicationInput = {
  borrowerName?: string | null;

  /** Token for upload links */
  token: string;

  /** Portal stage (already derived elsewhere) */
  portalStage:
    | "getting_started"
    | "documents_requested"
    | "documents_received"
    | "buddy_reviewing"
    | "additional_items_needed"
    | "ready_for_sba_review";

  /** Real activity events (newest-first or any order — VM re-sorts) */
  activity: CommunicationActivityEvent[];

  /** Blockers — typically required missing documents or unresolved gates */
  blockers: CommunicationBlocker[];

  /** Document items with normalized statuses (from 15I-5 input shape) */
  documents: CommunicationDocItem[];

  /** Recommendations from readiness layer */
  recommendations: CommunicationRecommendation[];

  /** Optional guidance next step (from 15H-4) */
  guidanceNextStep?: CommunicationGuidanceNextStep | null;

  /** Cap on recentUpdates length (default: 5) */
  maxRecentUpdates?: number;

  /** Cap on responseNeededItems length (default: 4) */
  maxResponseNeeded?: number;
};

// ---------------------------------------------------------------------------
// Waiting-on derivation
// ---------------------------------------------------------------------------

function deriveWaitingOn(
  input: CommunicationInput,
): { waitingOn: BorrowerWaitingOn; label: string } {
  const requiredMissing = input.documents.filter(
    (d) => d.required && d.status === "missing",
  ).length;
  const needsAttention = input.documents.filter(
    (d) => d.status === "needs_attention",
  ).length;
  const inFlight = input.documents.filter(
    (d) => d.status === "uploaded" || d.status === "reviewing",
  ).length;
  const hasBlockers = input.blockers.length > 0;

  if (hasBlockers || requiredMissing > 0) {
    return { waitingOn: "borrower", label: "Waiting on borrower documents" };
  }

  if (needsAttention > 0) {
    return { waitingOn: "clarification", label: "Waiting on clarification" };
  }

  if (
    input.portalStage === "ready_for_sba_review"
  ) {
    return { waitingOn: "banker_review", label: "Waiting on banker review" };
  }

  if (
    input.portalStage === "buddy_reviewing" ||
    input.portalStage === "documents_received" ||
    inFlight > 0
  ) {
    return { waitingOn: "buddy_review", label: "Waiting on Buddy review" };
  }

  if (input.portalStage === "getting_started") {
    return {
      waitingOn: "next_review_step",
      label: "Preparing your request list",
    };
  }

  return { waitingOn: "unknown", label: "No active wait" };
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

function deriveState(input: CommunicationInput): BorrowerCommunicationState {
  const criticalBlockers = input.blockers.filter(
    (b) => b.severity === "critical",
  ).length;
  const totalBlockers = input.blockers.length;
  const requiredMissing = input.documents.filter(
    (d) => d.required && d.status === "missing",
  ).length;
  const needsAttention = input.documents.filter(
    (d) => d.status === "needs_attention",
  ).length;
  const highPriorityRecs = input.recommendations.filter(
    (r) => r.priority === "high",
  ).length;

  if (criticalBlockers > 0) return "blocked";

  if (totalBlockers > 0 || requiredMissing > 0 || needsAttention > 0) {
    return "action_needed";
  }

  if (
    input.portalStage === "buddy_reviewing" ||
    input.portalStage === "documents_received" ||
    input.portalStage === "ready_for_sba_review"
  ) {
    return "waiting_on_review";
  }

  if (highPriorityRecs > 0) {
    return "update_available";
  }

  return "no_action_needed";
}

// ---------------------------------------------------------------------------
// Response needed items
// ---------------------------------------------------------------------------

function priorityRank(p: "required" | "helpful" | "optional"): number {
  if (p === "required") return 0;
  if (p === "helpful") return 1;
  return 2;
}

function buildResponseNeeded(
  input: CommunicationInput,
  cap: number,
): BorrowerResponseNeededItem[] {
  const items: BorrowerResponseNeededItem[] = [];

  // 1. Critical & standard blockers
  for (const blocker of input.blockers) {
    items.push({
      id: `blocker_${blocker.id}`,
      label: blocker.label,
      reason:
        blocker.reason ??
        "This item is blocking your package from moving to the next step.",
      priority: "required",
      href: blocker.href,
    });
  }

  // 2. Documents needing attention
  for (const doc of input.documents) {
    if (doc.status === "needs_attention") {
      items.push({
        id: `attention_${doc.id}`,
        label: doc.label,
        reason:
          "Buddy may need a clearer copy or all pages included before this item can move forward.",
        priority: "required",
        href: doc.href,
      });
    }
  }

  // 3. Required missing documents (not already represented by blockers)
  const blockerLabels = new Set(
    input.blockers.map((b) => b.label.toLowerCase()),
  );
  for (const doc of input.documents) {
    if (doc.required && doc.status === "missing") {
      if (blockerLabels.has(doc.label.toLowerCase())) continue;
      items.push({
        id: `missing_${doc.id}`,
        label: doc.label,
        reason:
          "This item is on Buddy's list of required documents for your SBA package.",
        priority: "required",
        href: doc.href,
      });
    }
  }

  // 4. High-priority recommendations
  for (const rec of input.recommendations) {
    if (rec.priority === "high") {
      items.push({
        id: `rec_${rec.id}`,
        label: rec.label,
        reason:
          rec.explanation ??
          "This recommendation may strengthen your package before lender review.",
        priority: "helpful",
        href: rec.href,
      });
    }
  }

  // 5. Guidance next step (only if it has an action and we are still light on items)
  if (
    items.length === 0 &&
    input.guidanceNextStep?.ctaLabel &&
    input.guidanceNextStep?.href
  ) {
    items.push({
      id: "guidance_next_step",
      label: input.guidanceNextStep.headline,
      reason:
        input.guidanceNextStep.description ??
        "Buddy has flagged this as the next helpful step.",
      priority: "helpful",
      href: input.guidanceNextStep.href,
    });
  }

  // Deduplicate by id then sort deterministically: priority, then label
  const seen = new Set<string>();
  const deduped: BorrowerResponseNeededItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const pa = priorityRank(a.priority);
    const pb = priorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    return a.label.localeCompare(b.label);
  });

  return deduped.slice(0, Math.max(0, cap));
}

// ---------------------------------------------------------------------------
// Recent updates
// ---------------------------------------------------------------------------

const ACTIVITY_TYPE_MAP: Record<
  CommunicationActivityEvent["category"],
  BorrowerCommunicationUpdateType
> = {
  upload: "document_received",
  review: "review_started",
  verification: "milestone_completed",
  milestone: "milestone_completed",
  request: "guidance_updated",
};

function parseTimestamp(input?: string | null): number {
  if (!input) return 0;
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : 0;
}

function buildRecentUpdates(
  input: CommunicationInput,
  cap: number,
): BorrowerCommunicationUpdate[] {
  const events: BorrowerCommunicationUpdate[] = [];

  for (const event of input.activity) {
    events.push({
      id: `activity_${event.id}`,
      label: event.label,
      timestamp: event.timestamp ?? undefined,
      type: ACTIVITY_TYPE_MAP[event.category] ?? "milestone_completed",
    });
  }

  // Documents needing attention surface as a borrower-safe update
  for (const doc of input.documents) {
    if (doc.status === "needs_attention") {
      events.push({
        id: `attention_${doc.id}`,
        label: `${doc.label} may need a clearer upload`,
        description:
          "Buddy flagged this item — uploading a clearer or complete version will resolve it.",
        type: "document_needs_attention",
      });
    }
  }

  if (input.blockers.length > 0) {
    for (const blocker of input.blockers) {
      events.push({
        id: `blocker_${blocker.id}`,
        label: `Action needed: ${blocker.label}`,
        description: blocker.reason,
        type: "blocker_added",
      });
    }
  }

  if (input.recommendations.some((r) => r.priority === "high")) {
    events.push({
      id: "recs_added",
      label: "Buddy added new recommendations",
      description: "Optional items that may strengthen your package.",
      type: "recommendation_added",
    });
  }

  if (
    input.portalStage === "buddy_reviewing" ||
    input.portalStage === "documents_received"
  ) {
    events.push({
      id: "review_started",
      label: "Buddy is reviewing your package",
      type: "review_started",
    });
  }

  if (
    input.blockers.length === 0 &&
    input.documents.every((d) => !d.required || d.status !== "missing") &&
    input.documents.every((d) => d.status !== "needs_attention")
  ) {
    events.push({
      id: "no_action_needed",
      label: "No borrower action needed right now",
      type: "no_action_needed",
    });
  }

  // Sort: events with timestamps newest-first; events without sit after
  events.sort((a, b) => {
    const ta = parseTimestamp(a.timestamp);
    const tb = parseTimestamp(b.timestamp);
    if (ta !== tb) return tb - ta;
    // Deterministic tiebreak by id
    return a.id.localeCompare(b.id);
  });

  // Deduplicate by label to avoid repeating the same update twice
  const seenLabels = new Set<string>();
  const deduped: BorrowerCommunicationUpdate[] = [];
  for (const ev of events) {
    const key = ev.label.toLowerCase();
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    deduped.push(ev);
  }

  return deduped.slice(0, Math.max(0, cap));
}

// ---------------------------------------------------------------------------
// Headline / summary / reassurance copy
// ---------------------------------------------------------------------------

function firstName(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first || null;
}

function buildHeadline(
  state: BorrowerCommunicationState,
  actionCount: number,
  name: string | null,
): string {
  switch (state) {
    case "blocked":
    case "action_needed": {
      const n = name ? `${name}, ` : "";
      if (actionCount === 0) {
        return `${n}a few items need your attention.`;
      }
      return `${n}${actionCount} item${actionCount === 1 ? "" : "s"} need${actionCount === 1 ? "s" : ""} your attention.`;
    }
    case "waiting_on_review":
      return name
        ? `${name}, your package is moving forward.`
        : "Your package is moving forward.";
    case "update_available":
      return name
        ? `${name}, Buddy has new updates for you.`
        : "Buddy has new updates for you.";
    case "no_action_needed":
      return name
        ? `${name}, no borrower action is needed right now.`
        : "No borrower action is needed right now.";
  }
}

function buildSummary(state: BorrowerCommunicationState): string {
  switch (state) {
    case "blocked":
      return "Your package has progress, but a critical item is blocking the next step. Resolving it keeps things moving.";
    case "action_needed":
      return "Buddy listed the items that need your response. Each card below explains why and how to respond.";
    case "waiting_on_review":
      return "Buddy is reviewing your recent uploads and updating your package. New items will appear here if anything else is needed.";
    case "update_available":
      return "Your required items are in good shape. Optional updates below may help strengthen your package.";
    case "no_action_needed":
      return "Buddy is organizing your package. Your completed items are saved and you do not need to upload anything again unless Buddy asks.";
  }
}

function buildReassurance(
  state: BorrowerCommunicationState,
): string | undefined {
  if (state === "no_action_needed") {
    return "Buddy will surface new items here if anything else is needed. Your completed items are saved.";
  }
  if (state === "waiting_on_review") {
    return "You do not need to re-upload documents unless Buddy requests them.";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Primary CTA
// ---------------------------------------------------------------------------

function buildPrimaryCta(
  state: BorrowerCommunicationState,
  responseItems: BorrowerResponseNeededItem[],
  token: string,
): { label?: string; href?: string } {
  if (state === "no_action_needed" || state === "waiting_on_review") {
    return {};
  }
  const firstActionable = responseItems.find((r) => r.href);
  if (firstActionable) {
    return {
      label: state === "blocked" ? "Resolve blocker" : "Add requested document",
      href: firstActionable.href,
    };
  }
  if (responseItems.length > 0) {
    return {
      label: state === "blocked" ? "Open document portal" : "Open document portal",
      href: `/upload/${token}`,
    };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerCommunicationViewModel(
  input: CommunicationInput,
): BorrowerCommunicationViewModel {
  const recentCap = input.maxRecentUpdates ?? 5;
  const responseCap = input.maxResponseNeeded ?? 4;

  const state = deriveState(input);
  const { waitingOn, label: waitingOnLabel } = deriveWaitingOn(input);
  const responseNeededItems = buildResponseNeeded(input, responseCap);
  const recentUpdates = buildRecentUpdates(input, recentCap);
  const name = firstName(input.borrowerName);

  // Total action-needed count uses the unfiltered response set so the count
  // reflects reality even when the displayed list is capped.
  const totalActionable = buildResponseNeeded(input, Number.MAX_SAFE_INTEGER)
    .filter((r) => r.priority === "required").length;

  const headline = buildHeadline(state, totalActionable, name);
  const summary = buildSummary(state);
  const reassuranceMessage = buildReassurance(state);
  const { label: primaryCtaLabel, href: primaryCtaHref } = buildPrimaryCta(
    state,
    responseNeededItems,
    input.token,
  );

  return {
    state,
    headline,
    summary,
    waitingOn,
    waitingOnLabel,
    actionNeededCount: totalActionable,
    responseNeededItems,
    recentUpdates,
    reassuranceMessage,
    primaryCtaLabel,
    primaryCtaHref,
  };
}
