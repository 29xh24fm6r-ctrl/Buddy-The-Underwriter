import "server-only";

/**
 * Brokerage next-best-action engine — SPEC-BROKERAGE-OPERATING-SYSTEM-V1
 * PR3 §5.5.
 *
 * Reuses the existing internal-readiness engine (getBuddyCanonicalState ->
 * deriveBuddyExplanation -> deriveNextActions, the same chain
 * buildBankerQueueSurface.ts uses) for document/underwriting-driven
 * actions, rather than forking a second decision engine for the same
 * facts. Adds brokerage-layer rules for the gaps that engine doesn't
 * cover: overdue tasks, deals with no next action defined, outstanding
 * items already tracked in deal_next_actions/brokerage_closing_conditions,
 * and stale submissions.
 *
 * "Stale referral relationship" from the spec's rule list is deliberately
 * not implemented here — PR1's crm_organizations has no last-contact
 * tracking (only crm_people does), and fabricating an approximate query
 * against the wrong table would misrepresent what's actually being
 * checked. Left for a future PR once that signal exists.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import type { BrokerageStage } from "./stages";

export type BrokerageNextAction = {
  actionType: string;
  title: string;
  why: string;
  dueDate: string | null;
  responsibleUser: string | null;
  relatedEntity: { kind: "deal"; id: string };
  blocking: boolean;
  sourceRule: string;
  actionRoute: string | null;
};

type DealRow = {
  id: string;
  brokerage_stage: BrokerageStage | null;
  brokerage_stage_entered_at: string | null;
  brokerage_stage_owner_clerk_user_id: string | null;
};

async function internalReadinessActions(dealId: string): Promise<BrokerageNextAction[]> {
  try {
    const { getBuddyCanonicalState } = await import("@/core/state/BuddyCanonicalStateAdapter");
    const { deriveBuddyExplanation } = await import("@/core/explanation/deriveBuddyExplanation");
    const { deriveNextActions } = await import("@/core/actions/deriveNextActions");

    const canonicalState = await getBuddyCanonicalState(dealId);
    const explanation = deriveBuddyExplanation(canonicalState);
    const { nextActions } = deriveNextActions({ canonicalState, explanation });

    return nextActions
      .filter((a) => a.code !== "no_action_required")
      .map((a) => ({
        actionType: a.code,
        title: a.label,
        why: a.description,
        dueDate: null,
        responsibleUser: null,
        relatedEntity: { kind: "deal" as const, id: dealId },
        blocking: a.priority === "critical",
        sourceRule: `internal_readiness:${a.code}`,
        actionRoute: `/deals/${dealId}/cockpit`,
      }));
  } catch {
    // Canonical state may not be computable yet for a brand-new deal —
    // non-fatal, brokerage-layer rules below still run.
    return [];
  }
}

async function brokerageLayerActions(deal: DealRow, sb: SB): Promise<BrokerageNextAction[]> {
  const actions: BrokerageNextAction[] = [];
  const now = new Date();

  const { data: openTasks } = await sb
    .from("brokerage_tasks")
    .select("id, title, due_at, assigned_to_clerk_user_id, blocking")
    .eq("deal_id", deal.id)
    .in("status", ["open", "in_progress", "blocked"]);
  const tasks = (openTasks ?? []) as Array<{ id: string; title: string; due_at: string | null; assigned_to_clerk_user_id: string | null; blocking: boolean }>;

  for (const t of tasks) {
    if (t.due_at && new Date(t.due_at) < now) {
      actions.push({
        actionType: "overdue_task",
        title: `Overdue: ${t.title}`,
        why: "This task's due date has passed.",
        dueDate: t.due_at,
        responsibleUser: t.assigned_to_clerk_user_id,
        relatedEntity: { kind: "deal", id: deal.id },
        blocking: t.blocking,
        sourceRule: "overdue_task",
        actionRoute: `/deals/${deal.id}/cockpit`,
      });
    }
  }

  if (deal.brokerage_stage && tasks.length === 0) {
    actions.push({
      actionType: "missing_next_action",
      title: "Define a next action for this deal",
      why: `This deal is in stage '${deal.brokerage_stage}' with no open tasks.`,
      dueDate: null,
      responsibleUser: deal.brokerage_stage_owner_clerk_user_id,
      relatedEntity: { kind: "deal", id: deal.id },
      blocking: false,
      sourceRule: "missing_next_action",
      actionRoute: `/deals/${deal.id}/cockpit`,
    });
  }

  const { data: openGuardActions } = await sb
    .from("deal_next_actions")
    .select("code, title")
    .eq("deal_id", deal.id)
    .eq("status", "open");
  for (const a of (openGuardActions ?? []) as Array<{ code: string; title: string }>) {
    actions.push({
      actionType: "outstanding_underwriting_condition",
      title: a.title,
      why: "Underwriting readiness check flagged this issue.",
      dueDate: null,
      responsibleUser: null,
      relatedEntity: { kind: "deal", id: deal.id },
      blocking: true,
      sourceRule: `deal_next_actions:${a.code}`,
      actionRoute: `/deals/${deal.id}/cockpit`,
    });
  }

  if (deal.brokerage_stage === "closing" || deal.brokerage_stage === "commitment") {
    const { data: openConditions } = await sb
      .from("brokerage_closing_conditions")
      .select("id, title")
      .eq("deal_id", deal.id)
      .eq("status", "open");
    for (const c of (openConditions ?? []) as Array<{ id: string; title: string }>) {
      actions.push({
        actionType: "closing_item",
        title: c.title,
        why: "Open closing condition must be satisfied or waived before funding.",
        dueDate: null,
        responsibleUser: null,
        relatedEntity: { kind: "deal", id: deal.id },
        blocking: true,
        sourceRule: "closing_condition",
        actionRoute: `/deals/${deal.id}/cockpit`,
      });
    }
  }

  if (deal.brokerage_stage === "submitted" && deal.brokerage_stage_entered_at) {
    const daysInStage = (now.getTime() - new Date(deal.brokerage_stage_entered_at).getTime()) / (24 * 3600 * 1000);
    if (daysInStage > 7) {
      actions.push({
        actionType: "submission_follow_up",
        title: "Follow up with lender on submission",
        why: `Submitted ${Math.floor(daysInStage)} days ago with no recorded stage change.`,
        dueDate: null,
        responsibleUser: deal.brokerage_stage_owner_clerk_user_id,
        relatedEntity: { kind: "deal", id: deal.id },
        blocking: false,
        sourceRule: "submission_follow_up",
        actionRoute: `/deals/${deal.id}/cockpit`,
      });
    }
  }

  return actions;
}

export async function deriveBrokerageNextActions(bankId: string, dealId: string, sb: SB = supabaseAdmin()): Promise<BrokerageNextAction[]> {
  const { data: deal, error } = await sb
    .from("deals")
    .select("id, brokerage_stage, brokerage_stage_entered_at, brokerage_stage_owner_clerk_user_id")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();
  if (error || !deal) throw new Error(`deriveBrokerageNextActions: deal not found (${error?.message ?? "no such deal"}).`);

  const [internal, brokerage] = await Promise.all([internalReadinessActions(dealId), brokerageLayerActions(deal as DealRow, sb)]);
  return [...brokerage, ...internal];
}
