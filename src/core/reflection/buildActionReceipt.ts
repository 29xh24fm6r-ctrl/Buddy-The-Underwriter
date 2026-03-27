/**
 * Action Receipt Builder — Phase 64
 *
 * Builds operator-visible confirmation receipts for every decision action.
 */

import type { ActionReceipt, AffectedSurfaceKey } from "./types";
import { getAffectedSurfaces } from "./affectedSurfaces";

const ACTION_MESSAGES: Record<string, string> = {
  "committee.decision.approved": "Deal approved by committee",
  "committee.decision.declined": "Deal declined by committee",
  "committee.decision.escalated": "Deal escalated for further review",
  "exception.decision.approve": "Exception approved",
  "exception.decision.reject": "Exception rejected",
  "exception.decision.escalate": "Exception escalated to committee",
  "pricing.decision.made": "Pricing decision recorded",
  "pricing.commit.approved": "Pricing committed",
  "pricing.commit.locked": "Pricing terms locked",
  "pricing.memo.published": "Pricing memo published",
  "checklist.status.set": "Checklist item status updated",
  "borrower.task.completed": "Borrower task completed",
  "borrower.task.returned": "Borrower task returned for revision",
  "borrower.task.clarification_requested": "Clarification requested from borrower",
};

export function buildActionReceipt(args: {
  actionKey: string;
  entityType: string;
  entityId: string;
  dealId?: string;
  bankId?: string;
  actorDisplay?: string;
  transition?: { from?: string; to?: string };
}): ActionReceipt {
  const affectedSurfaces = getAffectedSurfaces(args.actionKey);
  const message = ACTION_MESSAGES[args.actionKey] ?? `Action completed: ${args.actionKey}`;

  return {
    ok: true,
    actionKey: args.actionKey,
    entityType: args.entityType,
    entityId: args.entityId,
    dealId: args.dealId,
    bankId: args.bankId,
    actorDisplay: args.actorDisplay,
    occurredAt: new Date().toISOString(),
    transition: args.transition,
    affectedSurfaces,
    message,
  };
}
