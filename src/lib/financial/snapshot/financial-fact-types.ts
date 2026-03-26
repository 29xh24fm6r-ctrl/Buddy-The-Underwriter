/**
 * Phase 55A — Financial Fact Provenance + Validation Types
 */

export type FactValidationState =
  | "unreviewed"
  | "auto_supported"
  | "needs_review"
  | "banker_confirmed"
  | "banker_adjusted"
  | "rejected"
  | "conflicted"
  | "missing";

export type FactProvenanceSource = {
  documentId: string | null;
  extractedField: string | null;
  spreadLineRef: string | null;
  manualAdjustmentSource: string | null;
  confidence: number | null;
};

export type FinancialSnapshotFact = {
  id: string;
  snapshotId: string;
  dealId: string;
  metricKey: string;
  metricLabel: string;
  periodKey: string;
  entityKey: string | null;
  numericValue: number | null;
  textValue: string | null;
  unit: string | null;
  extractionConfidence: number | null;
  validationState: FactValidationState;
  conflictState: string | null;
  primaryDocumentId: string | null;
  provenance: FactProvenanceSource[];
  reviewerUserId: string | null;
  reviewerRationale: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FactDecisionAction =
  | "confirm_fact"
  | "select_conflict_source"
  | "adjust_fact"
  | "reject_fact"
  | "mark_follow_up_needed";

export type FactDecisionInput = {
  factId: string;
  snapshotId: string;
  dealId: string;
  action: FactDecisionAction;
  reviewerUserId: string;
  reviewerMembershipId?: string;
  rationale?: string;
  selectedProvenanceSourceDocumentId?: string;
  replacementValue?: number;
};
