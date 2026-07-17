import "server-only";

/**
 * Automation orchestrator — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.5.
 *
 * Idempotent: every (trigger, entity, action, dedupeKey) combination is
 * recorded in crm_automation_executions before the action's side effect
 * runs; a pre-check against that table (belt) plus the table's own unique
 * constraint (suspenders) is the same two-layer pattern PR3's
 * generateStageTaskPlan used, applied here to a broader trigger set.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import {
  findLeadStale,
  findTaskOverdue,
  findConditionOverdue,
  findLenderResponseMissing,
  findReferralRelationshipStale,
  findDocumentMissing,
  type TriggerFinding,
} from "./triggers";
import { runAutomationAction, type AutomationActionKey } from "./actions";
import type { TaskCategory } from "@/lib/tasks/types";

export const AUTOMATION_TRIGGERS = [
  "lead_stale",
  "task_overdue",
  "condition_overdue",
  "lender_response_missing",
  "referral_relationship_stale",
  "document_missing",
] as const;

export type AutomationTriggerKey = (typeof AUTOMATION_TRIGGERS)[number];

type TriggerConfig = {
  find: (bankId: string, sb: SB) => Promise<TriggerFinding[]>;
  actionKey: AutomationActionKey;
  title: (finding: TriggerFinding) => string;
  category?: TaskCategory;
};

const TRIGGER_CONFIG: Record<AutomationTriggerKey, TriggerConfig> = {
  lead_stale: {
    find: findLeadStale,
    actionKey: "notify_owner",
    title: () => "Lead is stale — follow up needed",
  },
  task_overdue: {
    find: findTaskOverdue,
    actionKey: "escalate",
    title: (f) => `Overdue task: ${f.context.title}`,
  },
  condition_overdue: {
    find: findConditionOverdue,
    actionKey: "create_task",
    title: (f) => `Overdue closing condition: ${f.context.conditionTitle}`,
    category: "closing",
  },
  lender_response_missing: {
    find: findLenderResponseMissing,
    actionKey: "create_task",
    title: () => "No lender response since submission — follow up",
    category: "lender_follow_up",
  },
  referral_relationship_stale: {
    find: (bankId, sb) => findReferralRelationshipStale(bankId, 60, sb),
    actionKey: "add_activity",
    title: () => "Referral relationship has gone stale — reach out",
  },
  document_missing: {
    find: findDocumentMissing,
    actionKey: "create_task",
    title: (f) => `Missing document: ${f.context.documentTitle}`,
    category: "document_request",
  },
};

export type AutomationRunResult = {
  trigger: AutomationTriggerKey;
  found: number;
  created: number;
  alreadyExists: number;
  failed: number;
};

export async function runAutomationTrigger(bankId: string, trigger: AutomationTriggerKey, sb: SB = supabaseAdmin()): Promise<AutomationRunResult> {
  const config = TRIGGER_CONFIG[trigger];
  const findings = await config.find(bankId, sb);

  let created = 0;
  let alreadyExists = 0;
  let failed = 0;

  for (const finding of findings) {
    const { data: existing } = await sb
      .from("crm_automation_executions")
      .select("id")
      .eq("trigger_key", trigger)
      .eq("entity_type", finding.entityType)
      .eq("entity_id", finding.entityId)
      .eq("action_key", config.actionKey)
      .eq("dedupe_key", finding.dedupeKey)
      .maybeSingle();

    if (existing) {
      alreadyExists++;
      continue;
    }

    try {
      const result = await runAutomationAction(
        { bankId, finding, actionKey: config.actionKey, title: config.title(finding), category: config.category },
        sb,
      );
      await sb.from("crm_automation_executions").insert({
        bank_id: bankId,
        trigger_key: trigger,
        entity_type: finding.entityType,
        entity_id: finding.entityId,
        action_key: config.actionKey,
        dedupe_key: finding.dedupeKey,
        execution_status: result.status === "created" ? "created" : "noop",
        payload: result.detail as any,
      });
      created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sb.from("crm_automation_executions").insert({
        bank_id: bankId,
        trigger_key: trigger,
        entity_type: finding.entityType,
        entity_id: finding.entityId,
        action_key: config.actionKey,
        dedupe_key: finding.dedupeKey,
        execution_status: "failed",
        payload: { error: msg },
      }).then(null, () => {});
      failed++;
    }
  }

  return { trigger, found: findings.length, created, alreadyExists, failed };
}
