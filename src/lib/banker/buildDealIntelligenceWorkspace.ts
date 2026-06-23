/**
 * Banker Deal Intelligence Workspace — Shared Assembly Layer
 *
 * Deterministic, pure-function synthesizer that composes the borrower
 * operational continuity, submission orchestration, and lender-routing fit
 * intelligence into a single banker deal workspace shape: unified header,
 * accessible navigation, per-workspace visibility flags, and passthrough VMs.
 *
 * Spec: 15T / Spec 16 — Banker Deal Detail Intelligence Workspace Integration
 *
 * Rules:
 * - Pure function, no DB / network calls
 * - No duplicated VM derivation — callers pass pre-built VMs
 * - Real state only — never invents readiness, urgency, or activity
 * - Workspaces gate their visibility based on whether the caller supplied
 *   meaningful inputs; never show "empty orchestration theatrics"
 * - Deterministic ordering for testability
 * - No approval / funding / lender-acceptance language
 */

import type { BorrowerOperationalContinuityViewModel } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import type { SubmissionOrchestrationViewModel } from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import type { LenderRoutingFitViewModel } from "@/lib/banker/buildLenderRoutingFitViewModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BankerWorkspaceSectionId =
  | "overview"
  | "submission_prep"
  | "orchestration"
  | "routing"
  | "timeline";

export type BankerWorkspaceNavItem = {
  id: BankerWorkspaceSectionId;
  label: string;
  href: string;
  visible: boolean;
};

export type BankerDealWorkspaceVisibility = {
  continuity: boolean;
  submissionPrep: boolean;
  orchestration: boolean;
  routing: boolean;
  timeline: boolean;
};

export type BankerDealWorkspaceHeader = {
  dealLabel: string;
  borrowerLabel?: string;
  operationalStateLabel: string;
  submissionReadinessLabel: string;
  routingReadinessLabel: string;
  waitingOnLabel: string;
  nextActionLabel: string;
  nextActionHref?: string;
  unresolvedIssueCount: number;
  recentActivitySummary?: string;
};

// Placeholder type for the future 15Q Submission Preparation Workspace.
// Adapters may pass a shape compatible with this type when the workspace VM
// becomes available; until then, the assembly layer treats the field as null.
export type SubmissionPreparationWorkspaceViewModelLike = {
  headline?: string;
  summary?: string;
} | null;

export type BankerDealIntelligenceWorkspace = {
  header: BankerDealWorkspaceHeader;
  navigation: BankerWorkspaceNavItem[];
  visibility: BankerDealWorkspaceVisibility;
  continuity: BorrowerOperationalContinuityViewModel | null;
  submissionPrep: SubmissionPreparationWorkspaceViewModelLike;
  orchestration: SubmissionOrchestrationViewModel | null;
  routing: LenderRoutingFitViewModel | null;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type BankerDealIntelligenceInput = {
  dealId: string;
  dealLabel?: string | null;
  borrowerLabel?: string | null;
  continuity?: BorrowerOperationalContinuityViewModel | null;
  submissionPrep?: SubmissionPreparationWorkspaceViewModelLike;
  orchestration?: SubmissionOrchestrationViewModel | null;
  routing?: LenderRoutingFitViewModel | null;
  /**
   * If supplied, overrides the default anchor base (`""`). Useful when the
   * workspace is mounted under a deal-detail route and the anchors need a
   * different prefix.
   */
  anchorPrefix?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimOrNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Visibility derivation
// ---------------------------------------------------------------------------

function deriveVisibility(
  input: BankerDealIntelligenceInput,
): BankerDealWorkspaceVisibility {
  const continuity = input.continuity ?? null;
  const orchestration = input.orchestration ?? null;
  const routing = input.routing ?? null;
  const submissionPrep = input.submissionPrep ?? null;

  // Continuity panel: visible whenever continuity VM is provided.
  const continuityVisible = !!continuity;

  // Submission prep panel: visible only when caller supplies a real 15Q VM
  // (it's a forward placeholder; defaulted to invisible until built).
  const submissionPrepVisible = !!submissionPrep;

  // Orchestration: visible once it has meaningful state — never in "not_started"
  // alone, but always in any other state (preparing/awaiting/review/ready/etc.).
  const orchestrationVisible =
    !!orchestration && orchestration.state !== "not_started";

  // Routing: visible once routing has meaningful inputs — hide "not_ready" to
  // avoid showing an empty routing panel.
  const routingVisible = !!routing && routing.state !== "not_ready";

  // Timeline section visibility: visible if any workspace contributes events.
  const timelineVisible = orchestrationVisible || continuityVisible;

  return {
    continuity: continuityVisible,
    submissionPrep: submissionPrepVisible,
    orchestration: orchestrationVisible,
    routing: routingVisible,
    timeline: timelineVisible,
  };
}

// ---------------------------------------------------------------------------
// Header derivation
// ---------------------------------------------------------------------------

function deriveHeader(
  input: BankerDealIntelligenceInput,
  visibility: BankerDealWorkspaceVisibility,
): BankerDealWorkspaceHeader {
  const dealLabel =
    trimOrNull(input.dealLabel) ??
    trimOrNull(input.borrowerLabel) ??
    `Deal ${input.dealId.slice(0, 8)}`;
  const borrowerLabel = trimOrNull(input.borrowerLabel) ?? undefined;

  const continuity = input.continuity ?? null;
  const orchestration = input.orchestration ?? null;
  const routing = input.routing ?? null;

  const operationalStateLabel =
    continuity?.headline ?? "Operational continuity not available yet";
  const submissionReadinessLabel =
    orchestration?.headline ?? "Submission orchestration not available yet";
  const routingReadinessLabel =
    routing?.routingReadinessLabel ?? "Routing intelligence not available yet";
  const waitingOnLabel = continuity?.waitingOnLabel ?? "No active wait";

  // Next action prefers orchestration (closest to lender submission), then
  // continuity, then routing. Never invents copy when none are available.
  let nextActionLabel = "No banker action required right now";
  let nextActionHref: string | undefined;
  if (visibility.orchestration && orchestration) {
    nextActionLabel = orchestration.nextAction.label;
    if (orchestration.nextAction.href) nextActionHref = orchestration.nextAction.href;
  } else if (visibility.continuity && continuity) {
    nextActionLabel = continuity.nextBestAction.label;
    if (continuity.nextBestAction.href) nextActionHref = continuity.nextBestAction.href;
  } else if (visibility.routing && routing) {
    nextActionLabel = routing.nextAction.label;
    if (routing.nextAction.href) nextActionHref = routing.nextAction.href;
  }

  // Unresolved issue count: combine needs-attention + missing required docs +
  // open clarifications + routing required-missing inputs.
  const attentionFromContinuity = continuity?.momentum.needsAttentionCount ?? 0;
  const missingRequiredFromContinuity =
    continuity?.momentum.requiredDocumentsRemaining ?? 0;
  const openClarifications = orchestration
    ? orchestration.clarifications.filter((c) => c.status === "open").length
    : 0;
  const requiredMissingRouting = routing
    ? routing.missingInputs.filter((m) => m.priority === "required").length
    : 0;
  const unresolvedIssueCount =
    attentionFromContinuity +
    missingRequiredFromContinuity +
    openClarifications +
    requiredMissingRouting;

  // Recent activity summary: pull from continuity momentum count when present.
  const recentActivityCount = continuity?.momentum.recentActivityCount ?? 0;
  const recentActivitySummary =
    recentActivityCount > 0
      ? `${recentActivityCount} recent borrower event${recentActivityCount === 1 ? "" : "s"} on file.`
      : undefined;

  const header: BankerDealWorkspaceHeader = {
    dealLabel,
    operationalStateLabel,
    submissionReadinessLabel,
    routingReadinessLabel,
    waitingOnLabel,
    nextActionLabel,
    unresolvedIssueCount,
  };
  if (borrowerLabel) header.borrowerLabel = borrowerLabel;
  if (nextActionHref) header.nextActionHref = nextActionHref;
  if (recentActivitySummary) header.recentActivitySummary = recentActivitySummary;
  return header;
}

// ---------------------------------------------------------------------------
// Navigation derivation
// ---------------------------------------------------------------------------

function buildAnchor(prefix: string | undefined, fragment: string): string {
  const p = prefix && prefix.length > 0 ? prefix : "";
  return `${p}#${fragment}`;
}

const NAV_LABELS: Record<BankerWorkspaceSectionId, string> = {
  overview: "Overview",
  submission_prep: "Submission Prep",
  orchestration: "Orchestration",
  routing: "Routing Fit",
  timeline: "Timeline",
};

const NAV_ORDER: BankerWorkspaceSectionId[] = [
  "overview",
  "submission_prep",
  "orchestration",
  "routing",
  "timeline",
];

function deriveNavigation(
  visibility: BankerDealWorkspaceVisibility,
  anchorPrefix?: string,
): BankerWorkspaceNavItem[] {
  return NAV_ORDER.map((id) => {
    const visible =
      id === "overview"
        ? true
        : id === "submission_prep"
          ? visibility.submissionPrep
          : id === "orchestration"
            ? visibility.orchestration
            : id === "routing"
              ? visibility.routing
              : id === "timeline"
                ? visibility.timeline
                : false;
    return {
      id,
      label: NAV_LABELS[id],
      href: buildAnchor(anchorPrefix, `workspace-${id.replace(/_/g, "-")}`),
      visible,
    };
  });
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildDealIntelligenceWorkspace(
  input: BankerDealIntelligenceInput,
): BankerDealIntelligenceWorkspace {
  const visibility = deriveVisibility(input);
  const header = deriveHeader(input, visibility);
  const navigation = deriveNavigation(visibility, input.anchorPrefix);

  return {
    header,
    navigation,
    visibility,
    continuity: input.continuity ?? null,
    submissionPrep: input.submissionPrep ?? null,
    orchestration: input.orchestration ?? null,
    routing: input.routing ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public anchors used by UI cross-links + tests
// ---------------------------------------------------------------------------

export const BANKER_WORKSPACE_ANCHOR_IDS: Record<
  BankerWorkspaceSectionId,
  string
> = {
  overview: "workspace-overview",
  submission_prep: "workspace-submission-prep",
  orchestration: "workspace-orchestration",
  routing: "workspace-routing",
  timeline: "workspace-timeline",
};

export const BANKER_WORKSPACE_NAV_LABELS = NAV_LABELS;
export const BANKER_WORKSPACE_NAV_ORDER = NAV_ORDER;
