import "server-only";

/**
 * Phase 65H — Banker Queue Surface Builder
 *
 * Main orchestrator: collects active deals, derives queue items, builds summary.
 * Self-healing on read: recomputes fresh truth, does not trust stale snapshots.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { deriveNextActions } from "@/core/actions/deriveNextActions";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { deriveDealAgingSnapshot } from "@/core/sla/deriveDealAgingSnapshot";
import {
  CANONICAL_ACTION_EXECUTION_MAP,
  type CanonicalExecutionMode,
} from "@/core/actions/execution/canonicalActionExecutionMap";
import { deriveBankerQueueItem } from "./deriveBankerQueueItem";
import { deriveCommandCenterSummary } from "./deriveCommandCenterSummary";
import { getDealLatestActivity } from "@/lib/command-center/getDealLatestActivity";
import { getChangedSinceViewed } from "@/lib/command-center/getChangedSinceViewed";
import type {
  BankerQueueItem,
  CommandCenterSurface,
  CommandCenterFilters,
} from "./types";
import type { BuddyActionCode, BuddyNextAction } from "@/core/actions/types";

// ── Sorting ─────────────────────────────────────────────────────────────

const URGENCY_RANK: Record<string, number> = {
  critical: 0,
  urgent: 1,
  watch: 2,
  healthy: 3,
};

function sortQueueItems(items: BankerQueueItem[]): BankerQueueItem[] {
  return items.sort((a, b) => {
    // 1. Urgency bucket
    const ua = URGENCY_RANK[a.urgencyBucket] ?? 4;
    const ub = URGENCY_RANK[b.urgencyBucket] ?? 4;
    if (ua !== ub) return ua - ub;

    // 2. Urgency score desc
    if (a.urgencyScore !== b.urgencyScore) return b.urgencyScore - a.urgencyScore;

    // 3. Executable now first
    const ea = a.actionability === "execute_now" ? 0 : 1;
    const eb = b.actionability === "execute_now" ? 0 : 1;
    if (ea !== eb) return ea - eb;

    // 4. Latest activity desc
    if (a.latestActivityAt && b.latestActivityAt) {
      return new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime();
    }
    if (a.latestActivityAt) return -1;
    if (b.latestActivityAt) return 1;

    return 0;
  });
}

// ── Filtering ───────────────────────────────────────────────────────────

function applyFilters(
  items: BankerQueueItem[],
  filters: CommandCenterFilters,
): BankerQueueItem[] {
  let result = items;
  if (filters.urgency) {
    result = result.filter((i) => i.urgencyBucket === filters.urgency);
  }
  if (filters.domain) {
    result = result.filter((i) => i.queueDomain === filters.domain);
  }
  if (filters.blockingParty) {
    result = result.filter((i) => i.blockingParty === filters.blockingParty);
  }
  if (filters.actionability) {
    result = result.filter((i) => i.actionability === filters.actionability);
  }
  if (filters.changedSinceViewed) {
    result = result.filter((i) => i.changedSinceViewed);
  }
  return result;
}

// ── Build Surface ───────────────────────────────────────────────────────

export async function buildBankerQueueSurface(
  bankId: string,
  userId: string,
  filters: CommandCenterFilters = {},
): Promise<CommandCenterSurface> {
  const sb = supabaseAdmin();

  // 1. Collect active deals for this bank
  const { data: deals } = await sb
    .from("deals")
    .select("id, name, borrower_name")
    .eq("bank_id", bankId)
    .not("archived_at", "is", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const activeDeals = deals ?? [];

  // 2. Get auto-advance count for today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: autoAdvancedToday } = await sb
    .from("deal_timeline_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", "auto_advance")
    .gte("created_at", todayStart.toISOString())
    .in(
      "deal_id",
      activeDeals.map((d) => d.id),
    );

  // 3. Derive queue items in parallel (batched)
  const items: BankerQueueItem[] = [];

  // Process in batches of 20 to avoid overwhelming DB
  const BATCH_SIZE = 20;
  for (let i = 0; i < activeDeals.length; i += BATCH_SIZE) {
    const batch = activeDeals.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((deal) =>
        deriveSingleDealQueueItem(deal, bankId, userId),
      ),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        items.push(result.value);
      }
    }
  }

  // 4. Sort, filter, summarize
  const sorted = sortQueueItems(items);
  const filtered = applyFilters(sorted, filters);
  const summary = deriveCommandCenterSummary(sorted, autoAdvancedToday ?? 0);

  return {
    summary,
    items: filtered,
    computedAt: new Date().toISOString(),
  };
}

// ── Single Deal Derivation ──────────────────────────────────────────────

async function deriveSingleDealQueueItem(
  deal: { id: string; name: string; borrower_name: string | null },
  bankId: string,
  userId: string,
): Promise<BankerQueueItem | null> {
  try {
    const sb = supabaseAdmin();

    // Parallel: canonical state + borrower campaign + activity + changed
    const [canonicalState, campaignSummary, latestActivity, changedSinceViewed] =
      await Promise.all([
        getBuddyCanonicalState(deal.id),
        getBorrowerCampaignSummary(deal.id),
        getDealLatestActivity(deal.id),
        getChangedSinceViewed(deal.id, userId),
      ]);

    // Derive explanation + actions
    const explanation = deriveBuddyExplanation(canonicalState);
    const actionResult = deriveNextActions({
      canonicalState,
      explanation,
    });

    const primaryAction = actionResult.primaryAction;
    const actionCode = (primaryAction?.code ?? null) as BuddyActionCode | null;

    // Derive aging snapshot
    const agingSnapshot = await deriveDealAgingSnapshot({
      dealId: deal.id,
      canonicalStage: canonicalState.lifecycle,
      blockerCodes: canonicalState.blockers.map((b) => b.code),
      primaryAction,
    });

    // Check execution mode for primary action
    let executionMode: CanonicalExecutionMode | null = null;
    if (actionCode && actionCode in CANONICAL_ACTION_EXECUTION_MAP) {
      executionMode = CANONICAL_ACTION_EXECUTION_MAP[actionCode].mode;
    }

    // Check if action is directly executable
    const isActionExecutable =
      executionMode === "direct_write" || executionMode === "queue_job";

    // Active escalation count
    const { count: escalationCount } = await sb
      .from("deal_escalation_events")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", deal.id)
      .eq("is_active", true);

    // Review backlog
    const { count: reviewBacklog } = await sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", deal.id)
      .eq("review_status", "pending_review");

    return deriveBankerQueueItem(
      {
        dealId: deal.id,
        dealName: deal.name ?? `Deal ${deal.id.slice(0, 8)}`,
        borrowerName: deal.borrower_name ?? null,
        canonicalStage: canonicalState.lifecycle,
        blockerCodes: canonicalState.blockers.map((b) => b.code),
        primaryActionCode: actionCode,
        primaryActionLabel: primaryAction?.label ?? null,
        primaryActionPriority: primaryAction?.priority ?? null,
        isActionExecutable,
        agingSnapshot,
        borrowerCampaignStatus: campaignSummary.latestStatus,
        borrowerOverdueCount: campaignSummary.overdueCount,
        borrowerRemindersExhausted: campaignSummary.remindersExhausted,
        reviewBacklogCount: reviewBacklog ?? 0,
        activeEscalationCount: escalationCount ?? 0,
        latestActivityAt: latestActivity,
        changedSinceViewed,
      },
      {
        executionMode,
        isQueueJobRunning: false, // Could be enhanced to check pipeline state
      },
    );
  } catch (err) {
    console.error(
      `[buildBankerQueueSurface] Failed to derive queue item for deal ${deal.id}:`,
      err,
    );
    return null;
  }
}

// ── Borrower Campaign Summary ───────────────────────────────────────────

type CampaignSummary = {
  latestStatus: string | null;
  overdueCount: number;
  remindersExhausted: boolean;
};

async function getBorrowerCampaignSummary(
  dealId: string,
): Promise<CampaignSummary> {
  const sb = supabaseAdmin();

  const { data: campaigns } = await sb
    .from("borrower_request_campaigns")
    .select("id, status")
    .eq("deal_id", dealId)
    .in("status", ["sent", "in_progress", "queued"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (!campaigns || campaigns.length === 0) {
    return { latestStatus: null, overdueCount: 0, remindersExhausted: false };
  }

  const latestStatus = campaigns[0].status;

  // Count overdue items across open campaigns
  const campaignIds = campaigns.map((c) => c.id);
  const { count: overdueCount } = await sb
    .from("borrower_request_items")
    .select("id", { count: "exact", head: true })
    .in("campaign_id", campaignIds)
    .in("status", ["pending", "sent"])
    .not("due_at", "is", null)
    .lt("due_at", new Date().toISOString());

  // Check if reminders exhausted (3+ reminders on any campaign)
  const { data: reminderEvents } = await sb
    .from("borrower_request_events")
    .select("campaign_id")
    .in("campaign_id", campaignIds)
    .eq("event_type", "reminder_sent");

  const reminderCounts = new Map<string, number>();
  for (const ev of reminderEvents ?? []) {
    const count = reminderCounts.get(ev.campaign_id) ?? 0;
    reminderCounts.set(ev.campaign_id, count + 1);
  }
  const remindersExhausted = Array.from(reminderCounts.values()).some(
    (c) => c >= 3,
  );

  return {
    latestStatus,
    overdueCount: overdueCount ?? 0,
    remindersExhausted,
  };
}

// ── Snapshot Persistence ────────────────────────────────────────────────

export async function writeBankerQueueSnapshot(
  bankId: string,
  items: BankerQueueItem[],
): Promise<void> {
  const sb = supabaseAdmin();

  // Delete old snapshots for this bank
  await sb
    .from("banker_queue_snapshots")
    .delete()
    .eq("bank_id", bankId);

  if (items.length === 0) return;

  // Insert fresh snapshots
  const rows = items.map((item) => ({
    bank_id: bankId,
    deal_id: item.dealId,
    canonical_stage: item.canonicalStage,
    urgency_bucket: item.urgencyBucket,
    urgency_score: item.urgencyScore,
    primary_action_code: item.primaryActionCode,
    primary_action_label: item.primaryActionLabel,
    primary_action_priority: item.primaryActionPriority,
    primary_action_age_hours: item.primaryActionAgeHours,
    is_action_executable: item.isActionExecutable,
    queue_domain: item.queueDomain,
    queue_reason_code: item.queueReasonCode,
    queue_reason_label: item.queueReasonLabel,
    blocking_party: item.blockingParty,
    borrower_overdue_count: item.borrowerOverdueCount,
    review_backlog_count: item.reviewBacklogCount,
    active_escalation_count: item.activeEscalationCount,
    latest_activity_at: item.latestActivityAt,
    computed_at: new Date().toISOString(),
  }));

  await sb.from("banker_queue_snapshots").insert(rows);
}
