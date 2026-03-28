import "server-only";

/**
 * Phase 65G — SLA Snapshot Persistence
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DealAgingSnapshot } from "./types";

export async function writeSlaSnapshot(
  snapshot: DealAgingSnapshot,
  bankId: string,
): Promise<void> {
  const sb = supabaseAdmin();

  await sb.from("deal_sla_snapshots").insert({
    deal_id: snapshot.dealId,
    bank_id: bankId,
    canonical_stage: snapshot.canonicalStage,
    stage_started_at: snapshot.stageStartedAt,
    stage_age_hours: snapshot.stageAgeHours,
    primary_action_code: snapshot.primaryActionCode,
    primary_action_age_hours: snapshot.primaryActionAgeHours,
    borrower_campaigns_open: snapshot.borrowerCampaignsOpen,
    borrower_campaigns_overdue: snapshot.borrowerCampaignsOverdue,
    critical_items_overdue: snapshot.criticalItemsOverdue,
    banker_tasks_stale: snapshot.bankerTasksStale,
    is_stage_overdue: snapshot.isStageOverdue,
    is_primary_action_stale: snapshot.isPrimaryActionStale,
    is_deal_stuck: snapshot.isDealStuck,
    urgency_score: snapshot.urgencyScore,
    urgency_bucket: snapshot.urgencyBucket,
  });
}
