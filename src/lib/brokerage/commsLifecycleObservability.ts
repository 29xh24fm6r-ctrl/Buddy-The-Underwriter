/**
 * Phase 12C — Lifecycle Comms Observability
 *
 * Read-only helpers for admin visibility into lifecycle hook activity.
 * Never exposes raw payloads, message bodies, API keys, or full recipients.
 */

import type { LifecycleHookEvent } from "@/lib/brokerage/commsLifecycleHooks";

// ── Types ───────────────────────────────────────────────────────────────────

export type LifecycleHookEventRow = {
  event_type: string;
  channel: string;
  deal_id: string | null;
  recipient_masked: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type LifecycleHookSummary = {
  dealId: string | null;
  totalHookEvents: number;
  byHookType: Record<string, { received: number; enqueued: number; skipped: number; failed: number }>;
  latestTimestamp: string | null;
  latestSkipReasons: string[];
  relatedOutbox: { pending: number; sent: number; failed: number; exhausted: number };
  relatedNudges: number;
  relatedAlerts: number;
  warnings: string[];
};

export type LifecycleHookEventView = {
  event_type: string;
  outcome: "received" | "enqueued" | "skipped" | "failed";
  deal_id: string | null;
  channel: string;
  purpose: string | null;
  recipient_masked: string;
  reason: string | null;
  created_at: string;
};

type Row = Record<string, any>;
type SB = { from: (t: string) => any };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const HOOK_EVENT_PREFIX = "comms_lifecycle_hook_";
const HOOK_OUTCOMES = ["received", "enqueued", "skipped", "failed"] as const;

function parseOutcome(eventType: string): LifecycleHookEventView["outcome"] {
  for (const o of HOOK_OUTCOMES) {
    if (eventType.endsWith(`_${o}`)) return o;
  }
  return "received";
}

function parseLifecycleEvent(meta: Record<string, unknown> | null): LifecycleHookEvent | null {
  const ev = str(meta?.event as unknown);
  return ev as LifecycleHookEvent | null;
}

// ── Summary builder ────────────────────────────────────────────────────────

export function summarizeLifecycleHookOutcomes(
  events: LifecycleHookEventRow[],
  outboxItems?: Row[],
): LifecycleHookSummary {
  const byHookType: Record<string, { received: number; enqueued: number; skipped: number; failed: number }> = {};
  let latestTimestamp: string | null = null;
  const skipReasons: string[] = [];
  let dealId: string | null = null;

  for (const e of events) {
    if (!e.event_type.startsWith(HOOK_EVENT_PREFIX)) continue;

    const outcome = parseOutcome(e.event_type);
    const lifecycleEvent = parseLifecycleEvent(e.metadata as Record<string, unknown> | null) ?? "unknown";
    dealId ??= str(e.deal_id);

    byHookType[lifecycleEvent] ??= { received: 0, enqueued: 0, skipped: 0, failed: 0 };
    byHookType[lifecycleEvent][outcome]++;

    if (!latestTimestamp || e.created_at > latestTimestamp) latestTimestamp = e.created_at;

    if (outcome === "skipped") {
      const reason = str((e.metadata as any)?.reason);
      if (reason && !skipReasons.includes(reason)) skipReasons.push(reason);
    }
  }

  // Outbox counts
  const outbox = { pending: 0, sent: 0, failed: 0, exhausted: 0 };
  let nudges = 0;
  let alerts = 0;

  if (outboxItems) {
    for (const item of outboxItems) {
      const s = str(item.status) ?? "pending";
      if (s === "pending" || s === "sending") outbox.pending++;
      else if (s === "sent") outbox.sent++;
      else if (s === "failed") outbox.failed++;
      else if (s === "exhausted") outbox.exhausted++;

      const trigger = str(item.trigger_key);
      if (trigger === "missing_documents") nudges++;
      else alerts++;
    }
  }

  // Warnings
  const warnings: string[] = [];
  for (const [hookType, counts] of Object.entries(byHookType)) {
    if (counts.received > 0 && counts.enqueued === 0 && counts.failed === 0) {
      warnings.push(`${hookType}: hook fired ${counts.received} time(s) but no outbox items produced`);
    }
  }

  return {
    dealId,
    totalHookEvents: events.filter(e => e.event_type.startsWith(HOOK_EVENT_PREFIX)).length,
    byHookType,
    latestTimestamp,
    latestSkipReasons: skipReasons.slice(0, 10),
    relatedOutbox: outbox,
    relatedNudges: nudges,
    relatedAlerts: alerts,
    warnings,
  };
}

// ── DB query helpers ───────────────────────────────────────────────────────

export async function getRecentLifecycleCommsEvents(
  sb: SB,
  opts?: { dealId?: string; limit?: number },
): Promise<LifecycleHookEventView[]> {
  const limit = Math.min(opts?.limit ?? 25, 100);

  let q = sb
    .from("brokerage_comms_ledger")
    .select("event_type, channel, deal_id, recipient_masked, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit * 2); // overfetch to filter

  if (opts?.dealId) {
    q = q.eq("deal_id", opts.dealId);
  }

  const { data } = await q;
  const rows = ((data ?? []) as LifecycleHookEventRow[])
    .filter(r => r.event_type.startsWith(HOOK_EVENT_PREFIX))
    .slice(0, limit);

  return rows.map(r => ({
    event_type: r.event_type,
    outcome: parseOutcome(r.event_type),
    deal_id: str(r.deal_id),
    channel: r.channel ?? "email",
    purpose: str((r.metadata as any)?.purpose) ?? parseLifecycleEvent(r.metadata as Record<string, unknown> | null),
    recipient_masked: r.recipient_masked ?? "n/a",
    reason: str((r.metadata as any)?.reason) ?? null,
    created_at: r.created_at,
  }));
}

export async function getLifecycleCommsSummary(
  dealId: string,
  sb: SB,
): Promise<LifecycleHookSummary> {
  // Fetch ledger events for this deal
  const { data: ledgerData } = await sb
    .from("brokerage_comms_ledger")
    .select("event_type, channel, deal_id, recipient_masked, metadata, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(200);

  const events = ((ledgerData ?? []) as LifecycleHookEventRow[])
    .filter(r => r.event_type.startsWith(HOOK_EVENT_PREFIX));

  // Fetch related outbox items
  const { data: outboxData } = await sb
    .from("brokerage_comms_outbox")
    .select("status, trigger_key")
    .eq("deal_id", dealId);

  return summarizeLifecycleHookOutcomes(events, (outboxData ?? []) as Row[]);
}
