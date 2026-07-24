import "server-only";

/**
 * Lead pipeline queue queries — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR2 §4.4.
 *
 * Follows the existing threshold-based aging-query pattern from
 * src/lib/tempo/getReviewQueueAging.ts (compute a cutoff, filter against
 * it) rather than a materialized snapshot cache — PR2's lead volume doesn't
 * justify the heavier deal_sla_snapshots-style precompute.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { LEAD_STAGES, TERMINAL_STAGES, type LeadStage } from "./stages";
import { LEAD_SLA_POLICY } from "./sla";

export const LEAD_QUEUES = [
  "my_leads",
  "all",
  "unassigned",
  "overdue_follow_up",
  "no_contact_attempted",
  "stale",
  "qualified_not_converted",
  "nurture",
  "recently_converted",
  "lost_and_disqualified",
] as const;

export type LeadQueue = (typeof LEAD_QUEUES)[number];

const OPEN_STAGES: LeadStage[] = LEAD_STAGES.filter((s) => !TERMINAL_STAGES.has(s));

export type ListLeadQueueInput = {
  bankId: string;
  queue: LeadQueue;
  actorClerkUserId?: string | null;
  limit?: number;
};

export async function listLeadQueue(input: ListLeadQueueInput, sb: SB = supabaseAdmin()): Promise<any[]> {
  const limit = input.limit ?? 200;
  const now = new Date();

  let query = sb
    .from("brokerage_leads")
    .select("*")
    .eq("bank_id", input.bankId)
    .order("created_at", { ascending: false })
    .limit(limit);

  switch (input.queue) {
    case "my_leads":
      if (!input.actorClerkUserId) throw new Error("my_leads queue requires actorClerkUserId.");
      query = query.eq("owner_clerk_user_id", input.actorClerkUserId).in("status", OPEN_STAGES);
      break;
    case "all":
      break;
    case "unassigned":
      query = query.is("owner_clerk_user_id", null).in("status", OPEN_STAGES);
      break;
    case "overdue_follow_up":
      query = query.lt("next_action_due_at", now.toISOString()).in("status", OPEN_STAGES);
      break;
    case "no_contact_attempted":
      query = query.is("last_attempted_contact_at", null).in("status", ["new", "attempting_contact"]);
      break;
    case "stale": {
      const cutoff = new Date(now.getTime() - LEAD_SLA_POLICY.staleAfterHoursWithNoActivity * 3600 * 1000).toISOString();
      query = query
        .lt("stage_entered_at", cutoff)
        .in("status", OPEN_STAGES);
      break;
    }
    case "qualified_not_converted":
      query = query.in("status", ["qualified", "engagement_pending", "engagement_accepted", "application_started"]);
      break;
    case "nurture":
      query = query.eq("status", "nurture");
      break;
    case "recently_converted": {
      const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
      query = query.eq("status", "converted").gte("converted_at", cutoff);
      break;
    }
    case "lost_and_disqualified":
      query = query.in("status", ["lost", "disqualified", "withdrawn", "unresponsive"]);
      break;
    default:
      throw new Error(`Unknown lead queue: ${input.queue}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listLeadQueue(${input.queue}) failed: ${error.message}`);
  return data ?? [];
}

export type LeadWithAge = { id: string; created_at: string; stage_entered_at: string; [key: string]: unknown };

/** Age in whole days since creation — used for the pipeline card/row "Age" column. */
export function leadAgeDays(lead: LeadWithAge, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(lead.created_at).getTime()) / (24 * 3600 * 1000));
}
