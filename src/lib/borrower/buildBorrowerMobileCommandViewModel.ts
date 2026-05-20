/**
 * Borrower Mobile Command Center — View Model Builder
 *
 * Deterministic, pure-function synthesizer that produces a tight, mobile-first
 * summary by re-using already-derived borrower view models (journey,
 * readiness, guidance, documents, communication).
 *
 * Spec: 15K / Spec 7 — Mobile-First Borrower Command Center
 *
 * Rules:
 * - Pure function, no DB or network calls
 * - Consumes only existing VMs — no raw state re-derivation
 * - Borrower-safe plain English; no internal enums leak
 * - Never invents data; safe fallback when inputs are empty
 * - Deterministic ordering for testability
 */

import type { BorrowerJourneyViewModel } from "@/lib/borrower/buildBorrowerJourneyViewModel";
import type { BorrowerReadinessViewModel } from "@/lib/borrower/buildBorrowerReadinessViewModel";
import type { BorrowerGuidanceViewModel } from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import type { BorrowerCommunicationViewModel } from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import type { BorrowerDocumentExperienceViewModel } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerMobileCommandState =
  | "action_needed"
  | "blocked"
  | "waiting"
  | "no_action_needed"
  | "in_progress";

export type BorrowerMobilePriorityItem = {
  id: string;
  label: string;
  description?: string;
  priority: "required" | "helpful" | "optional";
  href?: string;
};

export type BorrowerMobileCommandViewModel = {
  state: BorrowerMobileCommandState;
  headline: string;
  summary: string;
  progressLabel: string;
  readinessLabel?: string;
  waitingOnLabel?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  priorityItems: BorrowerMobilePriorityItem[];
  documentPriorityItems: BorrowerMobilePriorityItem[];
  hasMoreDocumentItems: boolean;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type MobileCommandInput = {
  borrowerName?: string | null;
  token: string;
  journey: BorrowerJourneyViewModel;
  readiness?: BorrowerReadinessViewModel;
  guidance: BorrowerGuidanceViewModel;
  communication: BorrowerCommunicationViewModel;
  documents: BorrowerDocumentExperienceViewModel;

  /** Max items in priorityItems (default 3) */
  maxPriorityItems?: number;
  /** Max items in documentPriorityItems (default 3) */
  maxDocumentPriorityItems?: number;
};

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

function deriveState(
  comm: BorrowerCommunicationViewModel,
): BorrowerMobileCommandState {
  switch (comm.state) {
    case "blocked":
      return "blocked";
    case "action_needed":
      return "action_needed";
    case "waiting_on_review":
      return "waiting";
    case "no_action_needed":
      return "no_action_needed";
    case "update_available":
      return "in_progress";
  }
}

// ---------------------------------------------------------------------------
// Headline / summary
// ---------------------------------------------------------------------------

function firstName(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}

function buildHeadline(
  state: BorrowerMobileCommandState,
  input: MobileCommandInput,
): string {
  const guidanceHead = input.guidance.nextStep.headline;
  const count = input.communication.actionNeededCount;
  const name = firstName(input.borrowerName);

  switch (state) {
    case "blocked":
      return name
        ? `${name}, one item is blocking your package.`
        : "One item is blocking your package.";
    case "action_needed": {
      if (count === 0) {
        // Fall back to guidance next step
        return guidanceHead || "A few items need your attention.";
      }
      return `${count} item${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} your attention.`;
    }
    case "waiting":
      return "Buddy is reviewing your package.";
    case "in_progress":
      return "Your package is moving forward.";
    case "no_action_needed":
      return "No borrower action needed right now.";
  }
}

function buildSummary(
  state: BorrowerMobileCommandState,
  input: MobileCommandInput,
): string {
  switch (state) {
    case "blocked":
      return "Resolve the blocking item below to keep your package moving.";
    case "action_needed":
      return "Tap an item below to respond. Each one explains why Buddy needs it.";
    case "waiting":
      return "You do not need to upload anything again unless Buddy asks.";
    case "in_progress":
      return input.guidance.summary;
    case "no_action_needed":
      return "Buddy will surface new items here if anything else is needed.";
  }
}

// ---------------------------------------------------------------------------
// Progress + readiness labels
// ---------------------------------------------------------------------------

function buildProgressLabel(input: MobileCommandInput): string {
  const pct = Math.max(0, Math.min(100, Math.round(input.journey.progressPercent)));
  return `${pct}% complete`;
}

function buildReadinessLabel(
  input: MobileCommandInput,
): string | undefined {
  if (!input.readiness) return undefined;
  const band = input.readiness.readiness.band;
  switch (band) {
    case "near_submission_ready":
      return "Near submission ready";
    case "strong_progress":
      return "Strong progress";
    case "progressing":
      return "Progressing";
    case "early_stage":
      return "Early stage";
  }
}

// ---------------------------------------------------------------------------
// CTA selection
// ---------------------------------------------------------------------------

function buildPrimaryCta(
  state: BorrowerMobileCommandState,
  input: MobileCommandInput,
): { label?: string; href?: string } {
  // Waiting / no-action: no CTA
  if (state === "waiting" || state === "no_action_needed") {
    return {};
  }

  // Prefer the communication VM CTA (already derived from the same priorities)
  if (input.communication.primaryCtaHref && input.communication.primaryCtaLabel) {
    return {
      label: input.communication.primaryCtaLabel,
      href: input.communication.primaryCtaHref,
    };
  }

  // Fall back to guidance next step
  if (input.guidance.nextStep.href && input.guidance.nextStep.ctaLabel) {
    return {
      label: input.guidance.nextStep.ctaLabel,
      href: input.guidance.nextStep.href,
    };
  }

  // Generic fallback to the upload portal if the state implies action
  if (state === "action_needed" || state === "blocked") {
    return { label: "Open document portal", href: `/upload/${input.token}` };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Priority items
// ---------------------------------------------------------------------------

function priorityRank(p: "required" | "helpful" | "optional"): number {
  if (p === "required") return 0;
  if (p === "helpful") return 1;
  return 2;
}

function buildPriorityItems(
  input: MobileCommandInput,
  cap: number,
): BorrowerMobilePriorityItem[] {
  const fromComm = input.communication.responseNeededItems.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.reason,
    priority: item.priority,
    href: item.href,
  }));

  // Deterministic sort: priority then label
  const sorted = [...fromComm].sort((a, b) => {
    const pa = priorityRank(a.priority);
    const pb = priorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    return a.label.localeCompare(b.label);
  });

  return sorted.slice(0, Math.max(0, cap));
}

// ---------------------------------------------------------------------------
// Document priority items
// ---------------------------------------------------------------------------

function buildDocumentPriorityItems(
  input: MobileCommandInput,
  cap: number,
): {
  items: BorrowerMobilePriorityItem[];
  hasMore: boolean;
} {
  // Document experience VM already orders by attention rank
  const attention = input.documents.primaryAttentionItems;

  const mapped: BorrowerMobilePriorityItem[] = attention.map((req) => ({
    id: req.id,
    label: req.label,
    description:
      req.recoveryMessage ??
      req.guidance.whyItMatters,
    priority: req.required ? "required" : "helpful",
    href: req.href,
  }));

  const totalActionable = input.documents.groups.reduce(
    (sum, g) =>
      sum +
      g.requirements.filter(
        (r) =>
          r.status === "needs_attention" ||
          (r.required && r.status === "missing"),
      ).length,
    0,
  );

  return {
    items: mapped.slice(0, Math.max(0, cap)),
    hasMore: totalActionable > cap,
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerMobileCommandViewModel(
  input: MobileCommandInput,
): BorrowerMobileCommandViewModel {
  const priorityCap = input.maxPriorityItems ?? 3;
  const docCap = input.maxDocumentPriorityItems ?? 3;

  const state = deriveState(input.communication);
  const headline = buildHeadline(state, input);
  const summary = buildSummary(state, input);
  const progressLabel = buildProgressLabel(input);
  const readinessLabel = buildReadinessLabel(input);
  const waitingOnLabel =
    input.communication.waitingOn === "unknown"
      ? undefined
      : input.communication.waitingOnLabel;
  const { label: primaryCtaLabel, href: primaryCtaHref } = buildPrimaryCta(
    state,
    input,
  );
  const priorityItems = buildPriorityItems(input, priorityCap);
  const { items: documentPriorityItems, hasMore: hasMoreDocumentItems } =
    buildDocumentPriorityItems(input, docCap);

  return {
    state,
    headline,
    summary,
    progressLabel,
    readinessLabel,
    waitingOnLabel,
    primaryCtaLabel,
    primaryCtaHref,
    priorityItems,
    documentPriorityItems,
    hasMoreDocumentItems,
  };
}
