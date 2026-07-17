import "server-only";

/**
 * Automation actions — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.5.
 *
 * Every action is composed from primitives this program already built
 * (PR3's task system, PR4's activity logger) rather than new parallel
 * machinery. "queue_communication_for_approval" creates a task carrying
 * the drafted message for a human to review and send via the real
 * sendCrmEmail/sendCrmSms senders — it never sends anything itself,
 * matching §6.5's "Automatic send where policy permits / Draft-for-review
 * mode / Disabled mode" spectrum: this PR only implements draft-for-review
 * and disabled for template-triggered automation (never automatic-send),
 * since an automation firing an actual email/SMS with no human in the
 * loop is exactly the kind of thing that needs a policy decision this PR
 * doesn't have the authority to make silently.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { createTask, updateTaskFields } from "@/lib/tasks/tasks";
import type { TaskCategory } from "@/lib/tasks/types";
import { logActivity } from "@/lib/comms/activities";
import { getTemplate, renderTemplate, type TemplateTriggerKey } from "@/lib/comms/templates";
import type { TriggerFinding } from "./triggers";

export type AutomationActionKey = "create_task" | "notify_owner" | "add_activity" | "escalate" | "queue_communication_for_approval";

export type RunActionInput = {
  bankId: string;
  finding: TriggerFinding;
  actionKey: AutomationActionKey;
  title: string;
  category?: TaskCategory;
  ownerClerkUserId?: string | null;
  dueAt?: string | null;
  templateTriggerKey?: TemplateTriggerKey;
  mergeFields?: Record<string, string | null | undefined>;
};

function targetFieldFor(entityType: TriggerFinding["entityType"]): "dealId" | "leadId" | "personId" {
  if (entityType === "deal" || entityType === "task") return "dealId";
  if (entityType === "lead") return "leadId";
  return "personId";
}

export async function runAutomationAction(input: RunActionInput, sb: SB = supabaseAdmin()): Promise<{ status: "created" | "noop"; detail: unknown }> {
  const { finding } = input;
  // "task" findings (e.g. task_overdue) attach downstream actions to the
  // task's parent deal, not the task itself — brokerage_tasks isn't a
  // valid crm_activities/task target on its own.
  const effectiveEntityType = finding.entityType === "task" ? "deal" : finding.entityType;
  const effectiveEntityId = finding.entityType === "task" ? (finding.context.dealId as string) : finding.entityId;
  if (!effectiveEntityId) return { status: "noop", detail: "no resolvable target entity" };

  const targetField = targetFieldFor(effectiveEntityType);

  switch (input.actionKey) {
    case "create_task":
    case "notify_owner": {
      if (targetField !== "dealId") return { status: "noop", detail: "create_task currently supports deal-scoped findings only" };
      const task = await createTask(
        {
          bankId: input.bankId,
          title: input.title,
          category: input.category ?? "other",
          dealId: effectiveEntityId,
          assignedToClerkUserId: input.ownerClerkUserId ?? null,
          dueAt: input.dueAt ?? null,
          automationSource: `automation:${input.actionKey}`,
        },
        sb,
      );
      return { status: "created", detail: { taskId: task.id } };
    }
    case "add_activity": {
      const activity = await logActivity(
        {
          bankId: input.bankId,
          kind: "system",
          title: input.title,
          [targetField]: effectiveEntityId,
          source: "automated",
          properties: { automation: true, findingContext: finding.context },
        } as any,
        sb,
      );
      return { status: "created", detail: { activityId: activity.id } };
    }
    case "escalate": {
      if (finding.entityType !== "task") return { status: "noop", detail: "escalate only applies to task findings" };
      const task = await updateTaskFields({ bankId: input.bankId, taskId: finding.entityId, escalationState: "escalated" }, sb);
      return { status: "created", detail: { taskId: task.id } };
    }
    case "queue_communication_for_approval": {
      if (targetField !== "dealId") return { status: "noop", detail: "queue_communication_for_approval currently supports deal-scoped findings only" };
      let body = input.title;
      if (input.templateTriggerKey) {
        const template = await getTemplate(input.bankId, input.templateTriggerKey, "email", sb);
        if (template) body = renderTemplate(template.body, input.mergeFields ?? {});
      }
      const task = await createTask(
        {
          bankId: input.bankId,
          title: `Review & send: ${input.title}`,
          description: body,
          category: "internal_review",
          dealId: effectiveEntityId,
          assignedToClerkUserId: input.ownerClerkUserId ?? null,
          automationSource: `automation:queue_communication_for_approval`,
        },
        sb,
      );
      return { status: "created", detail: { taskId: task.id, draftedBody: body } };
    }
    default:
      return { status: "noop", detail: `unknown action ${input.actionKey}` };
  }
}
