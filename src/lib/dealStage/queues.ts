import "server-only";

/**
 * Management queues — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR3 §5.7.
 *
 * "Funded awaiting payment" is scoped to brokerage_stage='funded' only for
 * this PR — lender_invoices has no direct deal_id column (payment/deal
 * linkage lives in tables owned by the revenue system), and wiring that up
 * properly is PR5's job ("Intelligence, Analytics, Revenue... Command
 * Center"), not something to guess at here.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { TERMINAL_STAGES, BROKERAGE_STAGES, type BrokerageStage } from "./stages";

export const MANAGEMENT_QUEUES = [
  "my_work",
  "team_work",
  "overdue_tasks",
  "deals_no_next_action",
  "stalled_deals",
  "missing_documents",
  "ready_for_lender_strategy",
  "submitted_no_lender_response",
  "outstanding_conditions",
  "closing_next_30_days",
  "funded_awaiting_payment",
] as const;

export type ManagementQueue = (typeof MANAGEMENT_QUEUES)[number];

const OPEN_STAGES: BrokerageStage[] = BROKERAGE_STAGES.filter((s) => !TERMINAL_STAGES.has(s) && s !== "on_hold");
const STALE_AFTER_DAYS = 14;

export type ListManagementQueueInput = {
  bankId: string;
  queue: ManagementQueue;
  actorClerkUserId?: string | null;
  actorRole?: string | null;
  limit?: number;
};

/**
 * Deal ids belonging to a bank, for queue cases whose target table (closing
 * conditions / closing workflows) carries deal_id but no bank_id of its own.
 */
async function bankScopedDealIds(sb: SB, bankId: string, limit: number): Promise<string[]> {
  const { data } = await sb.from("deals").select("id").eq("bank_id", bankId).limit(Math.max(limit, 2000));
  return ((data ?? []) as Array<{ id: string }>).map((d) => d.id);
}

export async function listManagementQueue(input: ListManagementQueueInput, sb: SB = supabaseAdmin()): Promise<any[]> {
  const limit = input.limit ?? 200;
  const now = new Date();

  switch (input.queue) {
    case "my_work": {
      if (!input.actorClerkUserId) throw new Error("my_work queue requires actorClerkUserId.");
      const { data } = await sb
        .from("brokerage_tasks")
        .select("*")
        .eq("bank_id", input.bankId)
        .eq("assigned_to_clerk_user_id", input.actorClerkUserId)
        .in("status", ["open", "in_progress", "blocked"])
        .order("due_at", { ascending: true })
        .limit(limit);
      return data ?? [];
    }
    case "team_work": {
      if (!input.actorRole) throw new Error("team_work queue requires actorRole.");
      const { data } = await sb
        .from("brokerage_tasks")
        .select("*")
        .eq("bank_id", input.bankId)
        .eq("assigned_role", input.actorRole)
        .in("status", ["open", "in_progress", "blocked"])
        .order("due_at", { ascending: true })
        .limit(limit);
      return data ?? [];
    }
    case "overdue_tasks": {
      const { data } = await sb
        .from("brokerage_tasks")
        .select("*")
        .eq("bank_id", input.bankId)
        .lt("due_at", now.toISOString())
        .in("status", ["open", "in_progress", "blocked"])
        .order("due_at", { ascending: true })
        .limit(limit);
      return data ?? [];
    }
    case "deals_no_next_action": {
      // Deals in an open brokerage stage with no open task at all.
      const { data: deals } = await sb
        .from("deals")
        .select("id, name, brokerage_stage")
        .eq("bank_id", input.bankId)
        .in("brokerage_stage", OPEN_STAGES)
        .limit(limit);
      const dealRows = (deals ?? []) as Array<{ id: string; name: string; brokerage_stage: string }>;
      const results: any[] = [];
      for (const deal of dealRows) {
        const { data: tasks } = await sb
          .from("brokerage_tasks")
          .select("id")
          .eq("deal_id", deal.id)
          .in("status", ["open", "in_progress", "blocked"])
          .limit(1);
        if (!tasks || tasks.length === 0) results.push(deal);
      }
      return results;
    }
    case "stalled_deals": {
      const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 3600 * 1000).toISOString();
      const { data } = await sb
        .from("deals")
        .select("id, name, brokerage_stage, brokerage_stage_entered_at")
        .eq("bank_id", input.bankId)
        .in("brokerage_stage", OPEN_STAGES)
        .lt("brokerage_stage_entered_at", cutoff)
        .limit(limit);
      return data ?? [];
    }
    case "missing_documents": {
      const { data } = await sb
        .from("deal_checklist_items")
        .select("deal_id, title")
        .eq("bank_id", input.bankId)
        .eq("status", "missing")
        .eq("required", true)
        .limit(limit);
      return data ?? [];
    }
    case "ready_for_lender_strategy": {
      const { data } = await sb
        .from("deals")
        .select("id, name, brokerage_stage")
        .eq("bank_id", input.bankId)
        .eq("brokerage_stage", "packaging")
        .limit(limit);
      return data ?? [];
    }
    case "submitted_no_lender_response": {
      const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
      const { data } = await sb
        .from("deals")
        .select("id, name, brokerage_stage, brokerage_stage_entered_at")
        .eq("bank_id", input.bankId)
        .eq("brokerage_stage", "submitted")
        .lt("brokerage_stage_entered_at", cutoff)
        .limit(limit);
      return data ?? [];
    }
    case "outstanding_conditions": {
      // brokerage_closing_conditions has no bank_id column of its own —
      // scope through the bank's own deal ids first. Found missing
      // entirely (returning every tenant's open conditions) during live
      // QA of SPEC-BROKERAGE-OPERATING-SYSTEM-V1.
      const bankDealIds = await bankScopedDealIds(sb, input.bankId, limit);
      if (bankDealIds.length === 0) return [];
      const { data } = await sb
        .from("brokerage_closing_conditions")
        .select("deal_id, title, status")
        .eq("status", "open")
        .in("deal_id", bankDealIds)
        .limit(limit);
      return data ?? [];
    }
    case "closing_next_30_days": {
      const cutoff = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      // brokerage_closing_workflows has no bank_id column either — same fix.
      const bankDealIds = await bankScopedDealIds(sb, input.bankId, limit);
      if (bankDealIds.length === 0) return [];
      const { data } = await sb
        .from("brokerage_closing_workflows" as any)
        .select("deal_id, target_close_date, status")
        .lte("target_close_date", cutoff)
        .neq("status", "cancelled")
        .in("deal_id", bankDealIds)
        .limit(limit);
      return data ?? [];
    }
    case "funded_awaiting_payment": {
      const { data } = await sb
        .from("deals")
        .select("id, name, brokerage_stage")
        .eq("bank_id", input.bankId)
        .eq("brokerage_stage", "funded")
        .limit(limit);
      return data ?? [];
    }
    default:
      throw new Error(`Unknown management queue: ${input.queue}`);
  }
}
