/**
 * Phase 11G — Brokerage Comms Orchestrator
 *
 * Single entrypoint that decides which borrower nudges, banker alerts,
 * and outbox processing to run for a deal or batch.
 */

import { enqueueBorrowerNudges } from "@/lib/brokerage/borrowerNudges";
import { enqueueBankerAlerts, type BankerAlertPurpose } from "@/lib/brokerage/bankerAlerts";
import { processDueCommsOutbox } from "@/lib/brokerage/commsOutbox";

// ── Types ───────────────────────────────────────────────────────────────────

export type OrchestrationOptions = {
  processOutbox?: boolean;
  purposes?: {
    borrowerNudges?: boolean;
    bankerAlerts?: boolean;
  };
  alertPurpose?: BankerAlertPurpose;
  now?: Date | string;
  limit?: number;
};

export type OrchestrationCounts = {
  planned: number;
  enqueued: number;
  skipped: number;
};

export type OrchestrationResult = {
  dealId: string;
  borrowerNudges: OrchestrationCounts;
  bankerAlerts: OrchestrationCounts;
  outbox: { processed: number; sent: number; failed: number; retryScheduled: number; exhausted: number; skipped: number };
  warnings: string[];
};

export type BatchResult = {
  dealsProcessed: number;
  results: OrchestrationResult[];
  totalEnqueued: number;
  totalSkipped: number;
  warnings: string[];
};

type Row = Record<string, any>;
type SB = { from: (t: string) => any };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const INACTIVE_STATUSES = new Set(["closed", "declined", "funded", "archived", "docs_complete"]);

// ── Single deal orchestration ───────────────────────────────────────────────

export async function buildBrokerageCommsPlan(
  dealId: string,
  opts?: OrchestrationOptions,
): Promise<{ doBorrowerNudges: boolean; doBankerAlerts: boolean; doOutbox: boolean }> {
  const purposes = opts?.purposes ?? {};
  return {
    doBorrowerNudges: purposes.borrowerNudges !== false,
    doBankerAlerts: purposes.bankerAlerts !== false,
    doOutbox: opts?.processOutbox === true,
  };
}

export async function runBrokerageCommsForDeal(
  dealId: string,
  sb: SB,
  opts?: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const warnings: string[] = [];
  const plan = await buildBrokerageCommsPlan(dealId, opts);

  // Ledger: started
  await sb.from("brokerage_comms_ledger").insert({
    event_type: "brokerage_comms_orchestration_started",
    channel: "email",
    deal_id: dealId,
    recipient_masked: "orchestrator",
    metadata: { borrowerNudges: plan.doBorrowerNudges, bankerAlerts: plan.doBankerAlerts, outbox: plan.doOutbox },
    created_at: new Date().toISOString(),
  });

  let borrowerNudges: OrchestrationCounts = { planned: 0, enqueued: 0, skipped: 0 };
  let bankerAlerts: OrchestrationCounts = { planned: 0, enqueued: 0, skipped: 0 };
  let outbox = { processed: 0, sent: 0, failed: 0, retryScheduled: 0, exhausted: 0, skipped: 0 };

  try {
    // 1. Borrower nudges
    if (plan.doBorrowerNudges) {
      const nr = await enqueueBorrowerNudges(dealId, sb);
      borrowerNudges = { planned: 1, enqueued: nr.enqueued, skipped: nr.skipped };
      if (nr.skipReason) warnings.push(`borrower_nudge: ${nr.skipReason}`);
    }

    // 2. Banker alerts
    if (plan.doBankerAlerts) {
      const purpose = opts?.alertPurpose ?? "deal_ready_for_review";
      const ar = await enqueueBankerAlerts(dealId, purpose, sb);
      bankerAlerts = { planned: 1, enqueued: ar.enqueued, skipped: ar.skipped };
      if (ar.skipReason) warnings.push(`banker_alert: ${ar.skipReason}`);
    }

    // 3. Outbox processing
    if (plan.doOutbox) {
      const stubAdapter = async () => ({ ok: true as const, providerMessageId: `stub-${Date.now()}` });
      const or = await processDueCommsOutbox(sb, () => stubAdapter, opts?.limit ?? 10);
      outbox = { processed: or.processed, sent: or.sent, failed: or.failed, retryScheduled: or.retried, exhausted: or.exhausted, skipped: 0 };
    }

    // Ledger: completed
    await sb.from("brokerage_comms_ledger").insert({
      event_type: "brokerage_comms_orchestration_completed",
      channel: "email",
      deal_id: dealId,
      recipient_masked: "orchestrator",
      metadata: { borrowerNudges, bankerAlerts, outbox, warnings },
      created_at: new Date().toISOString(),
    });
  } catch (err: any) {
    warnings.push(`orchestration_error: ${err?.message ?? "unknown"}`);
    await sb.from("brokerage_comms_ledger").insert({
      event_type: "brokerage_comms_orchestration_failed",
      channel: "email",
      deal_id: dealId,
      recipient_masked: "orchestrator",
      metadata: { error: str(err?.message) ?? "unknown", warnings },
      created_at: new Date().toISOString(),
    }).then(() => {}, () => {});
  }

  return { dealId, borrowerNudges, bankerAlerts, outbox, warnings };
}

// ── Batch orchestration ─────────────────────────────────────────────────────

export async function runBrokerageCommsBatch(
  sb: SB,
  opts?: OrchestrationOptions,
): Promise<BatchResult> {
  const limit = opts?.limit ?? 20;
  const warnings: string[] = [];

  // Find active deals
  const { data: deals } = await sb
    .from("deals")
    .select("id, status")
    .order("created_at", { ascending: false })
    .limit(limit * 2); // overfetch to filter

  const activeDeals = ((deals ?? []) as Row[])
    .filter(d => !INACTIVE_STATUSES.has(str(d.status) ?? ""))
    .slice(0, limit);

  const results: OrchestrationResult[] = [];
  let totalEnqueued = 0;
  let totalSkipped = 0;

  for (const deal of activeDeals) {
    const r = await runBrokerageCommsForDeal(String(deal.id), sb, {
      ...opts,
      processOutbox: false, // batch mode does not auto-process outbox per deal
    });
    results.push(r);
    totalEnqueued += r.borrowerNudges.enqueued + r.bankerAlerts.enqueued;
    totalSkipped += r.borrowerNudges.skipped + r.bankerAlerts.skipped;
    warnings.push(...r.warnings);
  }

  // Optionally process outbox after all deals enqueued
  if (opts?.processOutbox) {
    const stubAdapter = async () => ({ ok: true as const, providerMessageId: `stub-${Date.now()}` });
    await processDueCommsOutbox(sb, () => stubAdapter, opts?.limit ?? 20);
  }

  return { dealsProcessed: activeDeals.length, results, totalEnqueued, totalSkipped, warnings };
}
