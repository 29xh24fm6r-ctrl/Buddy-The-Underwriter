import "server-only";

import { writeEvent } from "@/lib/ledger/writeEvent";

/**
 * Canonical Underwriting Observability Events
 *
 * Typed event helpers for memo / packet / underwrite flows.
 * All events are fire-and-forget — they never alter business outcomes.
 * Each event includes canonical state references for traceability.
 */

// ── Common Types ──────────────────────────────────────────────────────────

type BaseEventArgs = {
  dealId: string;
  actorUserId?: string | null;
};

// ── Memo Events ───────────────────────────────────────────────────────────

export function emitMemoGenerationRequested(args: BaseEventArgs & {
  snapshotId: string | null;
  pricingDecisionId: string | null;
}): void {
  void writeEvent({
    dealId: args.dealId,
    kind: "memo.generation.requested",
    actorUserId: args.actorUserId,
    scope: "memo",
    action: "generate_requested",
    meta: {
      snapshot_id: args.snapshotId,
      pricing_decision_id: args.pricingDecisionId,
    },
  });
}

export function emitMemoStaleDetected(args: BaseEventArgs & {
  currentInputHash: string;
  memoInputHash: string | null;
  reasons: string[];
}): void {
  void writeEvent({
    dealId: args.dealId,
    kind: "memo.stale.detected",
    scope: "memo",
    action: "stale_detected",
    meta: {
      current_input_hash: args.currentInputHash,
      memo_input_hash: args.memoInputHash,
      reasons: args.reasons,
    },
  });
}

export function emitMemoOverrideSaved(args: BaseEventArgs & {
  key: string;
  rejected: boolean;
}): void {
  void writeEvent({
    dealId: args.dealId,
    kind: "memo.override.saved",
    actorUserId: args.actorUserId,
    scope: "memo",
    action: "override_saved",
    meta: {
      override_key: args.key,
      rejected: args.rejected,
    },
  });
}

// ── Packet Events ─────────────────────────────────────────────────────────

export function emitPacketPreflightBlocked(args: BaseEventArgs & {
  blockers: string[];
}): void {
  void writeEvent({
    dealId: args.dealId,
    kind: "packet.preflight.blocked",
    scope: "committee",
    action: "preflight_blocked",
    meta: {
      blockers: args.blockers,
    },
  });
}

export function emitDecisionReadinessBlocked(args: BaseEventArgs & {
  blockers: string[];
  warnings: string[];
}): void {
  void writeEvent({
    dealId: args.dealId,
    kind: "decision.readiness.blocked",
    actorUserId: args.actorUserId,
    scope: "committee",
    action: "readiness_blocked",
    meta: {
      blockers: args.blockers,
      warnings: args.warnings,
    },
  });
}

// ── Underwrite Events ─────────────────────────────────────────────────────

export function emitUnderwriteSnapshotDrift(args: BaseEventArgs & {
  activeSnapshotId: string | null;
  latestFactUpdatedAt: string | null;
  snapshotUpdatedAt: string | null;
}): void {
  void writeEvent({
    dealId: args.dealId,
    kind: "underwrite.snapshot.drift",
    scope: "underwrite",
    action: "drift_detected",
    meta: {
      active_snapshot_id: args.activeSnapshotId,
      latest_fact_updated_at: args.latestFactUpdatedAt,
      snapshot_updated_at: args.snapshotUpdatedAt,
    },
  });
}

export function emitBankerActionExecuted(args: BaseEventArgs & {
  actionType: string;
  actionDetail: string;
}): void {
  void writeEvent({
    dealId: args.dealId,
    kind: "banker.action.executed",
    actorUserId: args.actorUserId,
    scope: "underwrite",
    action: "banker_action",
    meta: {
      action_type: args.actionType,
      action_detail: args.actionDetail,
    },
  });
}
