/**
 * Phase 54A — Canonical Condition Status Derivation
 *
 * Maps internal condition state + evidence into a borrower/banker-readable
 * canonical status. Works across both condition systems:
 * - deal_conditions (status: open/satisfied/waived/rejected)
 * - conditions_to_close (satisfied: boolean + evidence array)
 *
 * This is the SINGLE SOURCE OF TRUTH for "what status should this condition show?"
 */

export type CanonicalConditionStatus =
  | "pending"
  | "submitted"
  | "under_review"
  | "partially_satisfied"
  | "satisfied"
  | "rejected"
  | "waived";

export type ConditionStatusResult = {
  status: CanonicalConditionStatus;
  label: string;
  borrowerLabel: string;
  badgeColor: "gray" | "blue" | "amber" | "emerald" | "red" | "purple";
  confidence: number | null;
  reason: string | null;
};

type EvidenceEntry = {
  source?: string;
  doc_type?: string;
  confidence?: number;
  distinct_key_value?: string | null;
  happened_at?: string;
};

export type ConditionInput = {
  /** deal_conditions.status or derived from conditions_to_close */
  dbStatus: "open" | "satisfied" | "waived" | "rejected" | string;
  /** Whether a borrower has uploaded something targeted to this condition */
  hasBorrowerUpload: boolean;
  /** Number of linked documents (from condition_document_links) */
  linkedDocCount: number;
  /** Evidence array from conditions_to_close (MEGA 11) */
  evidence?: EvidenceEntry[];
  /** Whether classification/matching is still in progress */
  classificationPending?: boolean;
  /** Manual override status from banker */
  manualOverride?: "satisfied" | "rejected" | "waived" | null;
};

const STATUS_MAP: Record<CanonicalConditionStatus, Omit<ConditionStatusResult, "status" | "confidence" | "reason">> = {
  pending:              { label: "Pending",             borrowerLabel: "Needed",           badgeColor: "gray" },
  submitted:            { label: "Submitted",           borrowerLabel: "Uploaded",         badgeColor: "blue" },
  under_review:         { label: "Under Review",        borrowerLabel: "Under Review",     badgeColor: "amber" },
  partially_satisfied:  { label: "Partially Satisfied", borrowerLabel: "Partially Complete", badgeColor: "amber" },
  satisfied:            { label: "Satisfied",           borrowerLabel: "Complete",         badgeColor: "emerald" },
  rejected:             { label: "Rejected",            borrowerLabel: "Not Accepted",     badgeColor: "red" },
  waived:               { label: "Waived",              borrowerLabel: "Waived",           badgeColor: "purple" },
};

/**
 * Derive canonical condition status from internal state.
 * Pure function — no DB calls.
 */
export function deriveConditionStatus(input: ConditionInput): ConditionStatusResult {
  const { dbStatus, hasBorrowerUpload, linkedDocCount, evidence, classificationPending, manualOverride } = input;

  // Manual overrides take precedence
  if (manualOverride) {
    return buildResult(manualOverride, null, `Banker ${manualOverride}`);
  }

  // Terminal states from DB
  if (dbStatus === "waived") return buildResult("waived", null, "Waived by banker");
  if (dbStatus === "rejected") return buildResult("rejected", null, "Rejected by banker");
  if (dbStatus === "satisfied") {
    const avgConf = computeAverageConfidence(evidence);
    return buildResult("satisfied", avgConf, "Evidence accepted");
  }

  // Active states — derive from evidence
  if (classificationPending && (hasBorrowerUpload || linkedDocCount > 0)) {
    return buildResult("under_review", null, "Classification in progress");
  }

  if (evidence && evidence.length > 0) {
    // Has evidence but not yet satisfied — partially satisfied
    const avgConf = computeAverageConfidence(evidence);
    return buildResult("partially_satisfied", avgConf, `${evidence.length} evidence item(s) received`);
  }

  if (hasBorrowerUpload || linkedDocCount > 0) {
    return buildResult("submitted", null, "Upload received, pending review");
  }

  // Default: no evidence, no upload
  return buildResult("pending", null, null);
}

function buildResult(
  status: CanonicalConditionStatus,
  confidence: number | null,
  reason: string | null,
): ConditionStatusResult {
  return { status, ...STATUS_MAP[status], confidence, reason };
}

function computeAverageConfidence(evidence?: EvidenceEntry[]): number | null {
  if (!evidence || evidence.length === 0) return null;
  const confidences = evidence.map((e) => e.confidence).filter((c): c is number => c != null);
  if (confidences.length === 0) return null;
  return Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100;
}
