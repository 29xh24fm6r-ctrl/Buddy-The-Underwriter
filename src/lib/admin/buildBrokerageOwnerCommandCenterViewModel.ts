/**
 * Buddy SBA Owner Operating Command Center — View Model Builder
 *
 * Deterministic, pure-function synthesizer that aggregates banker-command-
 * center, per-deal orchestration/routing/continuity intelligence, optional
 * team assignment data, and optional real activity events into a unified
 * owner/admin operating cockpit:
 *   - pipeline summary
 *   - operational bottlenecks
 *   - team workload
 *   - executive attention queue
 *   - submission pipeline state distribution
 *   - capped activity feed
 *   - deterministic daily-brief bullets
 *
 * Spec: 16A / Spec 17 — Buddy SBA Owner Operating Command Center
 *
 * Rules:
 * - Pure function, no DB / network calls
 * - Operational visibility only — no approval, lender, or risk language
 * - Real state only — never invents revenue, SLA, urgency, or activity
 * - Deterministic ordering for testability
 * - Safe fallback for empty / minimal input
 */

import type { BankerCommandCenterViewModel } from "@/lib/banker/buildBankerCommandCenterViewModel";
import type { BorrowerOperationalContinuityViewModel } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import type { SubmissionOrchestrationViewModel } from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import type { LenderRoutingFitViewModel } from "@/lib/banker/buildLenderRoutingFitViewModel";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type BrokeragePipelineSummary = {
  activeDeals: number;
  bankerActionRequired: number;
  borrowerActionRequired: number;
  submissionPrepReady: number;
  routingReviewReady: number;
  unresolvedClarifications: number;
  stalledDeals: number;
  recentlyActiveDeals: number;
  submittedDeals?: number;
  fundedDeals?: number;
};

export type BrokerageBottleneckSeverity =
  | "low"
  | "moderate"
  | "elevated"
  | "critical";

export type BrokerageBottleneckId =
  | "banker_review_backlog"
  | "clarification_loops"
  | "stalled_deals"
  | "missing_document_concentration"
  | "routing_inputs_missing"
  | "submission_prep_backlog"
  | "borrower_no_activity";

export type BrokerageBottleneck = {
  id: BrokerageBottleneckId;
  label: string;
  description: string;
  severity: BrokerageBottleneckSeverity;
  affectedDeals: number;
  href?: string;
};

export type TeamWorkloadItem = {
  id: string;
  name: string;
  role: "banker" | "processor" | "admin";
  activeDeals: number;
  bankerActionRequired: number;
  clarificationWorkload: number;
  stalledDeals: number;
  recentActivityCount: number;
};

export type ExecutiveAttentionArea =
  | "submission"
  | "routing"
  | "borrower"
  | "banker"
  | "operations";

export type ExecutiveAttentionItem = {
  id: string;
  label: string;
  reason: string;
  severity: BrokerageBottleneckSeverity;
  area: ExecutiveAttentionArea;
  href?: string;
};

export type SubmissionPipelineStateId =
  | "preparing_package"
  | "awaiting_clarifications"
  | "ready_for_submission"
  | "submission_in_progress"
  | "submitted";

export type SubmissionPipelineStateSummary = {
  state: SubmissionPipelineStateId;
  count: number;
};

export type BrokerageActivityCategory =
  | "borrower"
  | "submission"
  | "routing"
  | "clarification"
  | "operations";

export type BrokerageActivityEvent = {
  id: string;
  label: string;
  timestamp?: string;
  category: BrokerageActivityCategory;
};

export type BrokerageOwnerCommandCenterViewModel = {
  headline: string;
  summary: string;
  pipeline: BrokeragePipelineSummary;
  bottlenecks: BrokerageBottleneck[];
  workload: TeamWorkloadItem[];
  executiveAttention: ExecutiveAttentionItem[];
  submissionPipeline: SubmissionPipelineStateSummary[];
  activity: BrokerageActivityEvent[];
  dailyBrief: string[];
};

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type BrokerageDealRecord = {
  dealId: string;
  borrowerLabel: string;
  /** Optional persisted assignment to a team member */
  assignedTeamMemberId?: string | null;
  continuity?: BorrowerOperationalContinuityViewModel | null;
  orchestration?: SubmissionOrchestrationViewModel | null;
  routing?: LenderRoutingFitViewModel | null;
  /** Real timestamp of last borrower activity, if available */
  lastActivityAt?: string | null;
};

export type BrokerageTeamMember = {
  id: string;
  name: string;
  role: "banker" | "processor" | "admin";
};

export type BrokerageOwnerCommandCenterInput = {
  /** Optional banker command-center VM, used for top-level pipeline totals */
  commandCenter?: BankerCommandCenterViewModel | null;
  /** Per-deal records used for everything beyond top-level totals */
  deals: BrokerageDealRecord[];
  /** Team members (banker / processor / admin) for workload aggregation */
  team?: BrokerageTeamMember[];
  /** Real activity events, with optional timestamps */
  activity?: BrokerageActivityEvent[];
  /** Submitted/funded volume — only used when caller supplies them */
  submittedDeals?: number;
  fundedDeals?: number;
  /** Optional ISO timestamp used as "now" for staleness derivation. */
  evaluatedAt?: string;
  /** Default 7. */
  staleDaysThreshold?: number;
  /** Caps and severity tuning */
  maxActivity?: number;
  bankerReviewBacklogElevated?: number; // default 8
  bankerReviewBacklogCritical?: number; // default 15
  clarificationsElevated?: number; // default 8
  clarificationsCritical?: number; // default 20
  /** Drilldown hrefs */
  bottleneckBaseHref?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimOrNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDay(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function diffDays(now: string | undefined, then: string | null | undefined): number | null {
  const a = parseDay(now);
  const b = parseDay(then);
  if (a === null || b === null) return null;
  return Math.max(0, a - b);
}

function clampSeverity(
  count: number,
  elevated: number,
  critical: number,
): BrokerageBottleneckSeverity {
  if (count <= 0) return "low";
  if (count >= critical) return "critical";
  if (count >= elevated) return "elevated";
  if (count >= Math.max(2, Math.floor(elevated / 2))) return "moderate";
  return "low";
}

// ---------------------------------------------------------------------------
// Submission pipeline aggregation
// ---------------------------------------------------------------------------

const PIPELINE_STATE_ORDER: SubmissionPipelineStateId[] = [
  "preparing_package",
  "awaiting_clarifications",
  "ready_for_submission",
  "submission_in_progress",
  "submitted",
];

function buildSubmissionPipeline(
  deals: BrokerageDealRecord[],
): SubmissionPipelineStateSummary[] {
  const counts: Record<SubmissionPipelineStateId, number> = {
    preparing_package: 0,
    awaiting_clarifications: 0,
    ready_for_submission: 0,
    submission_in_progress: 0,
    submitted: 0,
  };
  for (const deal of deals) {
    const state = deal.orchestration?.state;
    if (state === "preparing_package") counts.preparing_package += 1;
    else if (state === "awaiting_clarifications") counts.awaiting_clarifications += 1;
    else if (state === "ready_for_submission") counts.ready_for_submission += 1;
    else if (state === "submission_in_progress") counts.submission_in_progress += 1;
    else if (state === "submitted") counts.submitted += 1;
    // "not_started" / "package_review" are excluded from the operational pipeline view
  }
  return PIPELINE_STATE_ORDER.map((state) => ({ state, count: counts[state] }));
}

// ---------------------------------------------------------------------------
// Pipeline summary (top-level)
// ---------------------------------------------------------------------------

function buildPipelineSummary(
  input: BrokerageOwnerCommandCenterInput,
  pipeline: SubmissionPipelineStateSummary[],
): BrokeragePipelineSummary {
  const cc = input.commandCenter ?? null;
  const deals = input.deals;

  // Active deals: deals that have any operational continuity / orchestration
  // attached, OR all rows in commandCenter when no per-deal data was supplied.
  const activeDeals = cc?.summary.totalDeals ?? deals.length;

  // Banker / borrower action: prefer command center summary if supplied.
  const bankerActionRequired = cc?.summary.bankerActionRequired ?? 0;
  const borrowerActionRequired = cc?.summary.borrowerActionRequired ?? 0;
  const stalledDeals = cc?.summary.stalledDeals ?? 0;
  const recentlyActiveDeals = cc?.recentlyActive.length ?? 0;

  // Submission prep / routing readiness from per-deal records.
  const submissionPrepReady = pipeline
    .filter((s) => s.state === "ready_for_submission")
    .reduce((acc, s) => acc + s.count, 0);
  const routingReviewReady = deals.filter(
    (d) =>
      d.routing?.state === "routing_options_available" ||
      d.routing?.state === "ready_for_fit_review",
  ).length;

  // Unresolved clarifications: count of open clarification items across all
  // orchestrations.
  let unresolvedClarifications = 0;
  for (const deal of deals) {
    if (!deal.orchestration) continue;
    for (const c of deal.orchestration.clarifications) {
      if (c.status === "open") unresolvedClarifications += 1;
    }
  }

  const summary: BrokeragePipelineSummary = {
    activeDeals,
    bankerActionRequired,
    borrowerActionRequired,
    submissionPrepReady,
    routingReviewReady,
    unresolvedClarifications,
    stalledDeals,
    recentlyActiveDeals,
  };
  if (typeof input.submittedDeals === "number" && input.submittedDeals >= 0) {
    summary.submittedDeals = input.submittedDeals;
  }
  if (typeof input.fundedDeals === "number" && input.fundedDeals >= 0) {
    summary.fundedDeals = input.fundedDeals;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Bottlenecks
// ---------------------------------------------------------------------------

const BOTTLENECK_SEVERITY_RANK: Record<BrokerageBottleneckSeverity, number> = {
  critical: 0,
  elevated: 1,
  moderate: 2,
  low: 3,
};

function buildBottlenecks(
  input: BrokerageOwnerCommandCenterInput,
  pipeline: SubmissionPipelineStateSummary[],
  pipelineSummary: BrokeragePipelineSummary,
): BrokerageBottleneck[] {
  const bottlenecks: BrokerageBottleneck[] = [];
  const base = trimOrNull(input.bottleneckBaseHref);
  const baseHref = (suffix: string): string | undefined =>
    base ? `${base}/${suffix}` : undefined;

  const reviewElevated = input.bankerReviewBacklogElevated ?? 8;
  const reviewCritical = input.bankerReviewBacklogCritical ?? 15;
  const clarElevated = input.clarificationsElevated ?? 8;
  const clarCritical = input.clarificationsCritical ?? 20;

  // 1. Banker review backlog
  const reviewBacklog = pipelineSummary.bankerActionRequired;
  if (reviewBacklog > 0) {
    bottlenecks.push({
      id: "banker_review_backlog",
      label: "Banker review backlog",
      description: `${reviewBacklog} deal${reviewBacklog === 1 ? "" : "s"} awaiting banker review or attention.`,
      severity: clampSeverity(reviewBacklog, reviewElevated, reviewCritical),
      affectedDeals: reviewBacklog,
      ...(baseHref("banker-review") ? { href: baseHref("banker-review") } : {}),
    });
  }

  // 2. Clarification loops
  const clarifications = pipelineSummary.unresolvedClarifications;
  if (clarifications > 0) {
    bottlenecks.push({
      id: "clarification_loops",
      label: "Clarification backlog",
      description: `${clarifications} open clarification item${clarifications === 1 ? "" : "s"} across the pipeline.`,
      severity: clampSeverity(clarifications, clarElevated, clarCritical),
      affectedDeals: clarifications,
      ...(baseHref("clarifications") ? { href: baseHref("clarifications") } : {}),
    });
  }

  // 3. Stalled deals
  const stalled = pipelineSummary.stalledDeals;
  if (stalled > 0) {
    bottlenecks.push({
      id: "stalled_deals",
      label: "Stalled deals",
      description: `${stalled} deal${stalled === 1 ? "" : "s"} flagged stalled based on real activity timestamps.`,
      severity: clampSeverity(stalled, 3, 8),
      affectedDeals: stalled,
      ...(baseHref("stalled") ? { href: baseHref("stalled") } : {}),
    });
  }

  // 4. Missing document concentration
  const missingDocConcentration = input.deals.filter(
    (d) =>
      (d.orchestration?.state === "preparing_package" ||
        d.orchestration?.state === "awaiting_clarifications") &&
      (d.continuity?.momentum.requiredDocumentsRemaining ?? 0) > 0,
  ).length;
  if (missingDocConcentration > 0) {
    bottlenecks.push({
      id: "missing_document_concentration",
      label: "Missing document concentration",
      description: `${missingDocConcentration} deal${missingDocConcentration === 1 ? "" : "s"} with outstanding required uploads.`,
      severity: clampSeverity(missingDocConcentration, 6, 12),
      affectedDeals: missingDocConcentration,
      ...(baseHref("missing-docs") ? { href: baseHref("missing-docs") } : {}),
    });
  }

  // 5. Routing inputs missing
  const routingInputsMissing = input.deals.filter(
    (d) =>
      d.routing &&
      d.routing.state !== "routing_review_complete" &&
      d.routing.missingInputs.some((m) => m.priority === "required"),
  ).length;
  if (routingInputsMissing > 0) {
    bottlenecks.push({
      id: "routing_inputs_missing",
      label: "Routing inputs missing",
      description: `${routingInputsMissing} deal${routingInputsMissing === 1 ? "" : "s"} cannot proceed to routing review without missing inputs.`,
      severity: clampSeverity(routingInputsMissing, 5, 10),
      affectedDeals: routingInputsMissing,
      ...(baseHref("routing-inputs") ? { href: baseHref("routing-inputs") } : {}),
    });
  }

  // 6. Submission-prep backlog
  const prepBacklog =
    pipeline.find((s) => s.state === "preparing_package")?.count ?? 0;
  if (prepBacklog > 0) {
    bottlenecks.push({
      id: "submission_prep_backlog",
      label: "Submission preparation backlog",
      description: `${prepBacklog} deal${prepBacklog === 1 ? "" : "s"} in package preparation.`,
      severity: clampSeverity(prepBacklog, 6, 15),
      affectedDeals: prepBacklog,
      ...(baseHref("prep") ? { href: baseHref("prep") } : {}),
    });
  }

  // 7. Borrower no activity (only when evaluatedAt is supplied)
  if (input.evaluatedAt) {
    const threshold = input.staleDaysThreshold ?? 7;
    const inactive = input.deals.filter((d) => {
      const days = diffDays(input.evaluatedAt, d.lastActivityAt ?? null);
      return days !== null && days >= threshold;
    }).length;
    if (inactive > 0) {
      bottlenecks.push({
        id: "borrower_no_activity",
        label: "Borrowers inactive for a stretch",
        description: `${inactive} borrower${inactive === 1 ? "" : "s"} have no activity in the past ${threshold} day${threshold === 1 ? "" : "s"}.`,
        severity: clampSeverity(inactive, 4, 10),
        affectedDeals: inactive,
        ...(baseHref("inactive-borrowers")
          ? { href: baseHref("inactive-borrowers") }
          : {}),
      });
    }
  }

  // Sort by severity rank then by deal count desc then id
  bottlenecks.sort((a, b) => {
    const sa = BOTTLENECK_SEVERITY_RANK[a.severity];
    const sb = BOTTLENECK_SEVERITY_RANK[b.severity];
    if (sa !== sb) return sa - sb;
    if (a.affectedDeals !== b.affectedDeals) return b.affectedDeals - a.affectedDeals;
    return a.id.localeCompare(b.id);
  });

  return bottlenecks;
}

// ---------------------------------------------------------------------------
// Team workload
// ---------------------------------------------------------------------------

function buildWorkload(
  input: BrokerageOwnerCommandCenterInput,
): TeamWorkloadItem[] {
  const team = input.team ?? [];
  if (team.length === 0) return [];

  const byMember = new Map<string, TeamWorkloadItem>();
  for (const member of team) {
    byMember.set(member.id, {
      id: member.id,
      name: member.name,
      role: member.role,
      activeDeals: 0,
      bankerActionRequired: 0,
      clarificationWorkload: 0,
      stalledDeals: 0,
      recentActivityCount: 0,
    });
  }

  for (const deal of input.deals) {
    const assignedId = trimOrNull(deal.assignedTeamMemberId);
    if (!assignedId) continue;
    const slot = byMember.get(assignedId);
    if (!slot) continue;
    slot.activeDeals += 1;

    // Banker action required: derive from continuity handoff state
    const state = deal.continuity?.handoffState;
    if (
      state === "waiting_on_banker" ||
      state === "ready_for_banker_review" ||
      state === "needs_clarification" ||
      state === "ready_for_submission_prep" ||
      state === "borrower_blocked"
    ) {
      slot.bankerActionRequired += 1;
    }

    // Clarification workload: open clarifications for the deal
    const openClar = deal.orchestration?.clarifications.filter(
      (c) => c.status === "open",
    ).length ?? 0;
    slot.clarificationWorkload += openClar;

    // Stalled detection: only when evaluatedAt is supplied
    if (input.evaluatedAt && deal.lastActivityAt) {
      const days = diffDays(input.evaluatedAt, deal.lastActivityAt);
      const threshold = input.staleDaysThreshold ?? 7;
      if (days !== null && days >= threshold) {
        slot.stalledDeals += 1;
      }
    }

    slot.recentActivityCount += deal.continuity?.momentum.recentActivityCount ?? 0;
  }

  // Deterministic sort: activeDeals desc, then name
  return [...byMember.values()].sort((a, b) => {
    if (a.activeDeals !== b.activeDeals) return b.activeDeals - a.activeDeals;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Executive attention
// ---------------------------------------------------------------------------

function buildExecutiveAttention(
  input: BrokerageOwnerCommandCenterInput,
  pipelineSummary: BrokeragePipelineSummary,
  bottlenecks: BrokerageBottleneck[],
  workload: TeamWorkloadItem[],
): ExecutiveAttentionItem[] {
  const items: ExecutiveAttentionItem[] = [];
  const base = trimOrNull(input.bottleneckBaseHref);

  // 1. Critical bottlenecks bubble up as executive attention.
  for (const b of bottlenecks) {
    if (b.severity !== "critical" && b.severity !== "elevated") continue;
    items.push({
      id: `bn_${b.id}`,
      label: b.label,
      reason: b.description,
      severity: b.severity,
      area:
        b.id === "banker_review_backlog"
          ? "banker"
          : b.id === "clarification_loops"
            ? "submission"
            : b.id === "stalled_deals" || b.id === "borrower_no_activity"
              ? "borrower"
              : b.id === "routing_inputs_missing"
                ? "routing"
                : "operations",
      ...(b.href ? { href: b.href } : {}),
    });
  }

  // 2. Banker overload: bankers with > 8 active deals
  const overloaded = workload.filter((w) => w.activeDeals >= 8);
  for (const w of overloaded) {
    items.push({
      id: `overload_${w.id}`,
      label: `${w.name} is operationally loaded`,
      reason: `${w.activeDeals} active deal${w.activeDeals === 1 ? "" : "s"} assigned to ${w.name}.`,
      severity: w.activeDeals >= 12 ? "critical" : "elevated",
      area: "banker",
      ...(base ? { href: `${base}/team` } : {}),
    });
  }

  // 3. Deals lacking an operational owner
  const unowned = input.deals.filter(
    (d) => !trimOrNull(d.assignedTeamMemberId),
  ).length;
  if (unowned > 0) {
    items.push({
      id: "unowned_deals",
      label: "Deals without an operational owner",
      reason: `${unowned} deal${unowned === 1 ? "" : "s"} are not yet assigned to a banker/processor.`,
      severity: unowned >= 5 ? "elevated" : "moderate",
      area: "operations",
      ...(base ? { href: `${base}/unassigned` } : {}),
    });
  }

  // 4. Excessive clarification loops on a single deal
  const heavyClarDeals = input.deals.filter(
    (d) => (d.orchestration?.clarifications.filter((c) => c.status === "open").length ?? 0) >= 3,
  );
  if (heavyClarDeals.length > 0) {
    items.push({
      id: "heavy_clarification_loops",
      label: "Deals stuck in clarification loops",
      reason: `${heavyClarDeals.length} deal${heavyClarDeals.length === 1 ? "" : "s"} carry 3+ open clarification items.`,
      severity:
        heavyClarDeals.length >= 4
          ? "critical"
          : heavyClarDeals.length >= 2
            ? "elevated"
            : "moderate",
      area: "submission",
      ...(base ? { href: `${base}/clarifications` } : {}),
    });
  }

  // 5. Inactive borrower near completion (orchestration in ready_for_submission)
  if (input.evaluatedAt) {
    const threshold = input.staleDaysThreshold ?? 7;
    const nearCompletionStalled = input.deals.filter((d) => {
      if (d.orchestration?.state !== "ready_for_submission") return false;
      const days = diffDays(input.evaluatedAt, d.lastActivityAt ?? null);
      return days !== null && days >= threshold;
    });
    if (nearCompletionStalled.length > 0) {
      items.push({
        id: "near_completion_stalled",
        label: "Near-submission deals lacking recent activity",
        reason: `${nearCompletionStalled.length} deal${nearCompletionStalled.length === 1 ? "" : "s"} look ready for submission but borrower activity is older than ${threshold} days.`,
        severity: "elevated",
        area: "submission",
        ...(base ? { href: `${base}/near-completion` } : {}),
      });
    }
  }

  // Deterministic sort: severity rank, then label
  items.sort((a, b) => {
    const sa = BOTTLENECK_SEVERITY_RANK[a.severity];
    const sb = BOTTLENECK_SEVERITY_RANK[b.severity];
    if (sa !== sb) return sa - sb;
    return a.label.localeCompare(b.label);
  });

  return items;
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

function buildActivity(
  input: BrokerageOwnerCommandCenterInput,
): BrokerageActivityEvent[] {
  const cap = Math.max(0, input.maxActivity ?? 10);
  if (cap === 0) return [];
  const events: BrokerageActivityEvent[] = [];
  const seen = new Set<string>();

  for (const e of input.activity ?? []) {
    const label = trimOrNull(e.label);
    if (!label) continue;
    const timestamp = trimOrNull(e.timestamp ?? null) ?? undefined;
    const key = `${label}|${timestamp ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const event: BrokerageActivityEvent = {
      id: `activity_${e.id}`,
      label,
      category: e.category,
    };
    if (timestamp) event.timestamp = timestamp;
    events.push(event);
  }

  // Sort: dated newest-first, then undated by insertion order
  const dated = events.filter((e) => typeof e.timestamp === "string");
  const undated = events.filter((e) => typeof e.timestamp !== "string");
  dated.sort((a, b) =>
    a.timestamp! < b.timestamp! ? 1 : a.timestamp! > b.timestamp! ? -1 : 0,
  );
  const merged = [...dated, ...undated];
  return merged.slice(0, cap);
}

// ---------------------------------------------------------------------------
// Daily brief (deterministic synthesis)
// ---------------------------------------------------------------------------

function buildDailyBrief(
  pipelineSummary: BrokeragePipelineSummary,
  pipeline: SubmissionPipelineStateSummary[],
  bottlenecks: BrokerageBottleneck[],
): string[] {
  const bullets: string[] = [];

  const banker = pipelineSummary.bankerActionRequired;
  if (banker > 0) {
    bullets.push(
      `${banker} deal${banker === 1 ? " is" : "s are"} waiting on banker review.`,
    );
  }

  const ready =
    pipeline.find((s) => s.state === "ready_for_submission")?.count ?? 0;
  if (ready > 0) {
    bullets.push(
      `${ready} package${ready === 1 ? " is" : "s are"} ready for submission preparation.`,
    );
  }

  const clar = pipelineSummary.unresolvedClarifications;
  if (clar > 0) {
    bullets.push(
      `${clar} clarification item${clar === 1 ? " is" : "s are"} open across the pipeline.`,
    );
  }

  const stalled = pipelineSummary.stalledDeals;
  if (stalled > 0) {
    bullets.push(
      `${stalled} deal${stalled === 1 ? " is" : "s are"} stalled and may need outreach.`,
    );
  }

  const borrower = pipelineSummary.borrowerActionRequired;
  if (borrower > 0) {
    bullets.push(
      `${borrower} deal${borrower === 1 ? " is" : "s are"} waiting on borrower uploads.`,
    );
  }

  const criticalBottlenecks = bottlenecks.filter((b) => b.severity === "critical");
  if (criticalBottlenecks.length > 0) {
    bullets.push(
      `${criticalBottlenecks.length} operational bottleneck${criticalBottlenecks.length === 1 ? " is" : "s are"} at critical severity.`,
    );
  }

  if (bullets.length === 0) {
    bullets.push("No major operational issues surfaced from current state.");
  }

  return bullets;
}

// ---------------------------------------------------------------------------
// Headline + summary
// ---------------------------------------------------------------------------

function buildHeadline(pipelineSummary: BrokeragePipelineSummary): string {
  if (pipelineSummary.activeDeals === 0) {
    return "No active deals in the pipeline yet.";
  }
  return `Brokerage operating with ${pipelineSummary.activeDeals} active deal${pipelineSummary.activeDeals === 1 ? "" : "s"}.`;
}

function buildSummary(
  pipelineSummary: BrokeragePipelineSummary,
  pipeline: SubmissionPipelineStateSummary[],
): string {
  if (pipelineSummary.activeDeals === 0) {
    return "Operational view will populate as deals enter the pipeline.";
  }
  const ready =
    pipeline.find((s) => s.state === "ready_for_submission")?.count ?? 0;
  return `${pipelineSummary.bankerActionRequired} need banker action, ${pipelineSummary.borrowerActionRequired} waiting on borrower, ${ready} ready for submission preparation.`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBrokerageOwnerCommandCenterViewModel(
  input: BrokerageOwnerCommandCenterInput,
): BrokerageOwnerCommandCenterViewModel {
  // Stable input ordering by dealId so downstream derivations are deterministic.
  const sortedDeals = [...input.deals].sort((a, b) =>
    a.dealId.localeCompare(b.dealId),
  );
  const sortedInput: BrokerageOwnerCommandCenterInput = {
    ...input,
    deals: sortedDeals,
  };

  const submissionPipeline = buildSubmissionPipeline(sortedDeals);
  const pipelineSummary = buildPipelineSummary(sortedInput, submissionPipeline);
  const bottlenecks = buildBottlenecks(sortedInput, submissionPipeline, pipelineSummary);
  const workload = buildWorkload(sortedInput);
  const executiveAttention = buildExecutiveAttention(
    sortedInput,
    pipelineSummary,
    bottlenecks,
    workload,
  );
  const activity = buildActivity(sortedInput);
  const dailyBrief = buildDailyBrief(pipelineSummary, submissionPipeline, bottlenecks);
  const headline = buildHeadline(pipelineSummary);
  const summary = buildSummary(pipelineSummary, submissionPipeline);

  return {
    headline,
    summary,
    pipeline: pipelineSummary,
    bottlenecks,
    workload,
    executiveAttention,
    submissionPipeline,
    activity,
    dailyBrief,
  };
}

// ---------------------------------------------------------------------------
// Public labels (UI + tests)
// ---------------------------------------------------------------------------

export const BROKERAGE_BOTTLENECK_SEVERITY_LABELS: Record<
  BrokerageBottleneckSeverity,
  string
> = {
  low: "Low",
  moderate: "Moderate",
  elevated: "Elevated",
  critical: "Critical",
};

export const BROKERAGE_PIPELINE_STATE_LABELS: Record<
  SubmissionPipelineStateId,
  string
> = {
  preparing_package: "Preparing package",
  awaiting_clarifications: "Awaiting clarifications",
  ready_for_submission: "Ready for submission",
  submission_in_progress: "Submission in progress",
  submitted: "Submitted",
};

export const BROKERAGE_PIPELINE_STATE_ORDER = PIPELINE_STATE_ORDER;
