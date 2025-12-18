// Deterministic Stall/Priority Triggers
// NO AI - Pure Rules

export type TriggerType =
  | "STALL_3D"
  | "STALL_7D"
  | "STALL_14D"
  | "BLOCKING_HIGH"
  | "MISSING_DOC"
  | "NEWLY_REQUIRED"
  | "APPROACHING_DEADLINE";

export type TriggerDecision = {
  trigger_type: TriggerType;
  condition_id: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  metadata: Record<string, any>;
  triggered_at: string;
};

export function evaluateTriggers(
  dealId: string,
  conditions: any[],
  summary: any,
  now: Date = new Date()
): TriggerDecision[] {
  const triggers: TriggerDecision[] = [];

  for (const condition of conditions) {
    // Skip satisfied conditions
    if (condition.satisfied) continue;

    const lastEvaluated = condition.last_evaluated_at
      ? new Date(condition.last_evaluated_at)
      : new Date(condition.created_at || now);
    const daysSinceEval = Math.floor(
      (now.getTime() - lastEvaluated.getTime()) / (1000 * 60 * 60 * 24)
    );

    // BLOCKING_HIGH: Required condition that blocks closing
    if (condition.severity === "REQUIRED" && !summary.ready) {
      triggers.push({
        trigger_type: "BLOCKING_HIGH",
        condition_id: condition.id,
        priority: "HIGH",
        reason: `Required condition "${condition.title}" is blocking closing readiness`,
        metadata: {
          severity: condition.severity,
          blocks_closing: true,
        },
        triggered_at: now.toISOString(),
      });
    }

    // MISSING_DOC: Condition requires doc but no evidence
    if (
      condition.evidence?.doc_type &&
      (!condition.resolution_evidence || condition.resolution_evidence.length === 0)
    ) {
      triggers.push({
        trigger_type: "MISSING_DOC",
        condition_id: condition.id,
        priority: condition.severity === "REQUIRED" ? "HIGH" : "MEDIUM",
        reason: `Missing required document: ${condition.evidence.doc_type}`,
        metadata: {
          required_doc_type: condition.evidence.doc_type,
          tax_year: condition.evidence.tax_year,
        },
        triggered_at: now.toISOString(),
      });
    }

    // STALL_3D: Condition unchanged for 3+ days
    if (daysSinceEval >= 3 && daysSinceEval < 7) {
      triggers.push({
        trigger_type: "STALL_3D",
        condition_id: condition.id,
        priority: "MEDIUM",
        reason: `Condition "${condition.title}" has been outstanding for ${daysSinceEval} days`,
        metadata: {
          days_stalled: daysSinceEval,
          last_evaluated: lastEvaluated.toISOString(),
        },
        triggered_at: now.toISOString(),
      });
    }

    // STALL_7D: Condition unchanged for 7+ days
    if (daysSinceEval >= 7 && daysSinceEval < 14) {
      triggers.push({
        trigger_type: "STALL_7D",
        condition_id: condition.id,
        priority: "HIGH",
        reason: `Condition "${condition.title}" has been outstanding for ${daysSinceEval} days`,
        metadata: {
          days_stalled: daysSinceEval,
          last_evaluated: lastEvaluated.toISOString(),
        },
        triggered_at: now.toISOString(),
      });
    }

    // STALL_14D: Condition unchanged for 14+ days (critical)
    if (daysSinceEval >= 14) {
      triggers.push({
        trigger_type: "STALL_14D",
        condition_id: condition.id,
        priority: "HIGH",
        reason: `URGENT: Condition "${condition.title}" has been outstanding for ${daysSinceEval} days`,
        metadata: {
          days_stalled: daysSinceEval,
          last_evaluated: lastEvaluated.toISOString(),
        },
        triggered_at: now.toISOString(),
      });
    }

    // NEWLY_REQUIRED: Condition created recently (within 24 hours)
    const hoursSinceCreated = Math.floor(
      (now.getTime() - new Date(condition.created_at).getTime()) / (1000 * 60 * 60)
    );
    if (hoursSinceCreated <= 24 && condition.severity === "REQUIRED") {
      triggers.push({
        trigger_type: "NEWLY_REQUIRED",
        condition_id: condition.id,
        priority: "MEDIUM",
        reason: `New required condition added: "${condition.title}"`,
        metadata: {
          created_at: condition.created_at,
        },
        triggered_at: now.toISOString(),
      });
    }

    // APPROACHING_DEADLINE: If condition has due_date in metadata
    if (condition.metadata?.due_date) {
      const dueDate = new Date(condition.metadata.due_date);
      const daysUntilDue = Math.floor(
        (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntilDue >= 0 && daysUntilDue <= 7) {
        triggers.push({
          trigger_type: "APPROACHING_DEADLINE",
          condition_id: condition.id,
          priority: daysUntilDue <= 2 ? "HIGH" : "MEDIUM",
          reason: `Condition "${condition.title}" due in ${daysUntilDue} day(s)`,
          metadata: {
            due_date: condition.metadata.due_date,
            days_until_due: daysUntilDue,
          },
          triggered_at: now.toISOString(),
        });
      }
    }
  }

  // Deduplicate by condition_id (keep highest priority)
  const byCondition = new Map<string, TriggerDecision>();
  const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };

  for (const trigger of triggers) {
    const existing = byCondition.get(trigger.condition_id);
    if (
      !existing ||
      priorityOrder[trigger.priority] > priorityOrder[existing.priority]
    ) {
      byCondition.set(trigger.condition_id, trigger);
    }
  }

  return Array.from(byCondition.values()).sort(
    (a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]
  );
}
