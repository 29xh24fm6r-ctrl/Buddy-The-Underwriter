/**
 * Phase 11G — Brokerage Comms Orchestrator
 *
 * Single entrypoint that decides which borrower nudges, banker alerts,
 * and outbox processing to run for a deal or batch.
 */

import { enqueueBorrowerNudges } from "@/lib/brokerage/borrowerNudges";
import { enqueueBankerAlerts, type BankerAlertPurpose } from "@/lib/brokerage/bankerAlerts";
import { processDueCommsOutbox } from "@/lib/brokerage/commsOutbox";
import { buildOutboxAdapterFactory } from "@/lib/brokerage/commsAdapters";
import { logCommsModeResolvedOnce } from "@/lib/brokerage/commsMode";

// ── Types ───────────────────────────────────────────────────────────────────

export type OrchestrationOptions = {
  processOutbox?: boolean;
  purposes?: {
    borrowerNudges?: boolean;
    bankerAlerts?: boolean;
  };
  alertPurpose?: BankerAlertPurpose;
  now?: Date | string;
  /** How many deals one batch walks. Also the per-deal outbox drain when run for a single deal. */
  limit?: number;
  /**
   * How many outbox rows a batch drains. Defaults to twice the deal limit
   * because a deal can enqueue both a borrower nudge and a banker alert, so a
   * drain sized to the deal count falls permanently behind the enqueue rate.
   */
  outboxLimit?: number;
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
  await logCommsModeResolvedOnce(sb); // throws on unrecognized BROKERAGE_COMMS_MODE
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

    // 3. Outbox processing — send through the env-mode-resolved adapters
    // (audit H2: was a hardcoded stub that marked messages "sent" without
    // sending). BROKERAGE_COMMS_MODE=stub still stubs; =live actually sends.
    if (plan.doOutbox) {
      const or = await processDueCommsOutbox(sb, buildOutboxAdapterFactory(), opts?.limit ?? 10);
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

  // Advance the rotation cursor. This runs on the failure path too, on purpose:
  // if a deal that throws kept a null cursor it would sort to the head of the
  // queue forever and starve every deal behind it — the exact failure mode this
  // cursor exists to end. A stamp that cannot be written is a warning, never a
  // failure of the run, because the messages have already been enqueued.
  const stampError = await markDealCommsRun(dealId, sb);
  if (stampError) warnings.push(`comms_cursor: ${stampError}`);

  return { dealId, borrowerNudges, bankerAlerts, outbox, warnings };
}

/**
 * Stamps deals.brokerage_comms_last_run_at. Returns a message on failure rather
 * than throwing, so a cursor write can never lose messages the batch just
 * enqueued.
 */
async function markDealCommsRun(dealId: string, sb: SB): Promise<string | null> {
  try {
    const { error } = await sb
      .from("deals")
      .update({ brokerage_comms_last_run_at: new Date().toISOString() })
      .eq("id", dealId);
    return error ? String(error.message ?? "update_failed") : null;
  } catch (err: any) {
    return String(err?.message ?? "update_threw");
  }
}

// ── Batch orchestration ─────────────────────────────────────────────────────

export async function runBrokerageCommsBatch(
  sb: SB,
  opts?: OrchestrationOptions,
): Promise<BatchResult> {
  const limit = opts?.limit ?? 20;
  const warnings: string[] = [];

  // Find active deals, least-recently-contacted first.
  //
  // This used to order by created_at desc, which meant every run picked the same
  // newest `limit` deals and every deal ranked past that was never contacted at
  // all — not delayed, never. Ordering by the rotation cursor ascending with
  // nulls first puts never-processed deals at the head and then walks the whole
  // active set, so a batch that is smaller than the pipeline still reaches every
  // deal instead of re-serving the same window forever.
  //
  // The overfetch is still needed because the inactive-status filter runs here
  // rather than in the query: `status` is nullable and a PostgREST `not.in`
  // would drop null-status rows, which this filter deliberately keeps.
  const { data: deals } = await sb
    .from("deals")
    .select("id, status, brokerage_comms_last_run_at")
    .order("brokerage_comms_last_run_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(Math.min(limit * 4, 500));

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

  // Optionally process outbox after all deals enqueued — real env-mode adapters.
  // The drain is sized independently of the deal limit: each deal can enqueue a
  // borrower nudge *and* a banker alert, so draining only `limit` rows per run
  // would let the outbox grow faster than it empties.
  if (opts?.processOutbox) {
    await processDueCommsOutbox(sb, buildOutboxAdapterFactory(), opts?.outboxLimit ?? limit * 2);
  }

  return { dealsProcessed: activeDeals.length, results, totalEnqueued, totalSkipped, warnings };
}
