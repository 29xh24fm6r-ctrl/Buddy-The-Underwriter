// Pure function. No DB. No side effects. No network.
import type {
  RelationshipSurfaceItem,
  RelationshipSurfaceAction,
  RelationshipSurfaceCaseRef,
  RelationshipSurfaceTimelineEntry,
  RelationshipEvidenceEnvelope,
  RelationshipSurfaceEvidenceSummary,
  RelationshipSurfaceReasonFamily,
  RelationshipSurfaceActionability,
} from "./types";
import { lookupReason } from "./relationshipSurfaceReasonCatalog";
import { deriveRelationshipSurfacePriority } from "./deriveRelationshipSurfacePriority";
import type { PriorityDerivationInput } from "./types";

export interface BuildSurfaceItemInput {
  relationshipId: string;
  bankId: string;
  canonicalState: string;
  health: string;
  blockingParty: "banker" | "borrower" | "portfolio" | "system" | "none";
  priorityInput: PriorityDerivationInput;
  changedSinceViewed: boolean;
  explanationLines: string[];
  supportingActions: RelationshipSurfaceAction[];
  openCases: RelationshipSurfaceCaseRef[];
  timelinePreview: RelationshipSurfaceTimelineEntry[];
  evidenceSummary: RelationshipSurfaceEvidenceSummary;
  computedAt: string;
}

/**
 * Build a complete RelationshipSurfaceItem from derived inputs.
 * Calls the priority arbitration engine internally.
 */
export function buildRelationshipSurfaceItem(
  input: BuildSurfaceItemInput,
): RelationshipSurfaceItem {
  const priority = deriveRelationshipSurfacePriority(input.priorityInput);
  const reasonEntry = lookupReason(priority.primaryReasonCode);

  const primaryReasonFamily: RelationshipSurfaceReasonFamily =
    reasonEntry?.family ?? "informational";
  const primaryReasonLabel = reasonEntry?.label ?? priority.primaryReasonCode;
  const primaryReasonDescription = reasonEntry?.description ?? "";
  const primaryActionability: RelationshipSurfaceActionability =
    reasonEntry?.defaultActionability ?? "monitor_only";
  const primaryActionLabel = priority.primaryActionCode
    ? formatActionLabel(priority.primaryActionCode)
    : null;

  return {
    relationshipId: input.relationshipId,
    bankId: input.bankId,
    canonicalState: input.canonicalState,
    health: input.health,
    blockingParty: input.blockingParty,
    priorityBucket: priority.priorityBucket,
    priorityScore: priority.priorityScore,
    primaryReasonCode: priority.primaryReasonCode,
    primaryReasonFamily,
    primaryReasonLabel,
    primaryReasonDescription,
    primaryActionCode: priority.primaryActionCode,
    primaryActionLabel,
    primaryActionability,
    isPrimaryActionExecutable:
      primaryActionability === "execute_now" ||
      primaryActionability === "approval_required",
    changedSinceViewed: input.changedSinceViewed,
    computedAt: input.computedAt,
    explanationLines: input.explanationLines.slice(0, 5),
    supportingActions: input.supportingActions.slice(0, 4),
    openCases: input.openCases,
    timelinePreview: input.timelinePreview.slice(0, 10),
    evidenceSummary: input.evidenceSummary,
  };
}

function formatActionLabel(actionCode: string): string {
  const labels: Record<string, string> = {
    review_relationship_health: "Review Relationship",
    resolve_monitoring_exception: "Resolve Exception",
    start_renewal_process: "Start Renewal",
    complete_annual_review: "Complete Annual Review",
    collect_borrower_documents: "Collect Borrower Items",
    approve_liquidation: "Review Liquidation",
    resolve_crypto_distress: "Resolve Crypto Distress",
    advance_crypto_cure: "Advance Cure",
    review_crypto_collateral: "Review Crypto Collateral",
    verify_custody_control: "Verify Custody",
    refresh_crypto_valuation: "Refresh Valuation",
    open_margin_call: "Open Margin Call",
  };
  return labels[actionCode] ?? actionCode.replace(/_/g, " ");
}
