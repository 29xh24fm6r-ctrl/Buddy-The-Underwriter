/**
 * Phase 54B — Condition Explanation Engine
 *
 * Generates borrower-safe explanations for every condition state.
 * Especially important for partially_satisfied, rejected, and under_review.
 *
 * Pure function — no DB calls.
 */

import type { CanonicalConditionStatus } from "@/lib/conditions/deriveConditionStatus";
import type { ConditionGuidance } from "./types";

type EvidenceItem = {
  doc_type?: string;
  confidence?: number;
  distinct_key_value?: string | null;
  happened_at?: string;
  source?: string;
};

type ExplainInput = {
  conditionId: string;
  title: string;
  canonicalStatus: CanonicalConditionStatus;
  evidence: EvidenceItem[];
  linkedDocCount: number;
  rejectionReason?: string | null;
  requiredDocs?: Array<{ label?: string; key?: string }>;
  examples?: string[];
  borrowerExplanation?: string;
};

/**
 * Generate a complete explanation for a condition in any state.
 */
export function explainConditionForBorrower(input: ExplainInput): ConditionGuidance {
  const { conditionId, title, canonicalStatus, evidence, linkedDocCount, rejectionReason, requiredDocs, examples, borrowerExplanation } = input;

  const whatWeReceived = buildWhatWeReceived(evidence, linkedDocCount);
  const whatIsStillNeeded = buildWhatIsStillNeeded(canonicalStatus, requiredDocs, evidence);
  const confidenceIndicator = computeConfidenceIndicator(evidence);
  const lastEventSummary = buildLastEventSummary(evidence);

  switch (canonicalStatus) {
    case "pending":
      return {
        conditionId,
        canonicalStatus,
        borrowerLabel: "Needed",
        borrowerExplanation: borrowerExplanation ?? `We need ${title.toLowerCase()} to move your application forward.`,
        whatWeReceived: [],
        whatIsStillNeeded: whatIsStillNeeded.length > 0 ? whatIsStillNeeded : [`Upload ${title.toLowerCase()}`],
        recommendedNextStep: `Upload the requested document for "${title}"`,
        examplesOfGoodEvidence: examples ?? [],
        confidenceIndicator: "none",
        lastEventSummary: null,
      };

    case "submitted":
      return {
        conditionId,
        canonicalStatus,
        borrowerLabel: "Uploaded",
        borrowerExplanation: "We received your upload and it is being processed. No action needed right now.",
        whatWeReceived,
        whatIsStillNeeded: [],
        recommendedNextStep: null,
        examplesOfGoodEvidence: [],
        confidenceIndicator: "medium",
        lastEventSummary,
      };

    case "under_review":
      return {
        conditionId,
        canonicalStatus,
        borrowerLabel: "Under Review",
        borrowerExplanation: "Your submission is being validated. We're checking that the document meets requirements. This usually takes a short time.",
        whatWeReceived,
        whatIsStillNeeded: [],
        recommendedNextStep: null,
        examplesOfGoodEvidence: [],
        confidenceIndicator,
        lastEventSummary,
      };

    case "partially_satisfied":
      return {
        conditionId,
        canonicalStatus,
        borrowerLabel: "Partially Complete",
        borrowerExplanation: buildPartialExplanation(title, evidence, requiredDocs),
        whatWeReceived,
        whatIsStillNeeded,
        recommendedNextStep: whatIsStillNeeded.length > 0
          ? `Upload: ${whatIsStillNeeded[0]}`
          : `Provide additional documentation for "${title}"`,
        examplesOfGoodEvidence: examples ?? [],
        confidenceIndicator,
        lastEventSummary,
      };

    case "rejected":
      return {
        conditionId,
        canonicalStatus,
        borrowerLabel: "Not Accepted",
        borrowerExplanation: buildRejectionExplanation(title, rejectionReason),
        whatWeReceived,
        whatIsStillNeeded: [`Re-upload: ${title}`],
        recommendedNextStep: `Please upload a replacement document that meets the requirements`,
        examplesOfGoodEvidence: examples ?? [],
        confidenceIndicator: "low",
        lastEventSummary,
      };

    case "satisfied":
      return {
        conditionId,
        canonicalStatus,
        borrowerLabel: "Complete",
        borrowerExplanation: `This item has been received and accepted. No further action needed.`,
        whatWeReceived,
        whatIsStillNeeded: [],
        recommendedNextStep: null,
        examplesOfGoodEvidence: [],
        confidenceIndicator: "high",
        lastEventSummary,
      };

    case "waived":
      return {
        conditionId,
        canonicalStatus,
        borrowerLabel: "Waived",
        borrowerExplanation: "This item has been waived by your lender. No action is needed.",
        whatWeReceived: [],
        whatIsStillNeeded: [],
        recommendedNextStep: null,
        examplesOfGoodEvidence: [],
        confidenceIndicator: "high",
        lastEventSummary: null,
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWhatWeReceived(evidence: EvidenceItem[], linkedDocCount: number): string[] {
  if (evidence.length === 0 && linkedDocCount === 0) return [];

  const items: string[] = [];
  const docTypes = new Set<string>();
  for (const e of evidence) {
    if (e.doc_type && !docTypes.has(e.doc_type)) {
      docTypes.add(e.doc_type);
      const label = humanizeDocType(e.doc_type);
      const detail = e.distinct_key_value ? ` (${e.distinct_key_value})` : "";
      items.push(`${label}${detail}`);
    }
  }

  if (items.length === 0 && linkedDocCount > 0) {
    items.push(`${linkedDocCount} document${linkedDocCount !== 1 ? "s" : ""} uploaded`);
  }
  return items;
}

function buildWhatIsStillNeeded(
  status: CanonicalConditionStatus,
  requiredDocs?: Array<{ label?: string; key?: string }>,
  evidence?: EvidenceItem[],
): string[] {
  if (status === "satisfied" || status === "waived") return [];

  const needs: string[] = [];
  if (requiredDocs) {
    for (const doc of requiredDocs) {
      const label = doc.label ?? doc.key ?? "Required document";
      // Check if we already have evidence for this type
      const evidenceTypes = new Set((evidence ?? []).map((e) => e.doc_type?.toLowerCase()));
      if (!evidenceTypes.has((doc.key ?? "").toLowerCase())) {
        needs.push(label);
      }
    }
  }
  return needs;
}

function buildPartialExplanation(
  title: string,
  evidence: EvidenceItem[],
  requiredDocs?: Array<{ label?: string; key?: string }>,
): string {
  const receivedCount = evidence.length;
  const neededCount = requiredDocs?.length ?? 0;

  if (receivedCount > 0 && neededCount > 0) {
    return `We received some of what's needed for "${title}", but additional documentation is still required. Please check below for what's missing.`;
  }
  if (receivedCount > 0) {
    return `We received ${receivedCount} item${receivedCount !== 1 ? "s" : ""} for "${title}", but more evidence is needed to complete this requirement.`;
  }
  return `Additional documentation is needed for "${title}".`;
}

function buildRejectionExplanation(title: string, reason?: string | null): string {
  if (reason) {
    const friendly = humanizeRejectionReason(reason);
    return `Your submission for "${title}" could not be accepted: ${friendly}. Please upload a replacement.`;
  }
  return `Your submission for "${title}" did not meet the requirements. Please review the guidance below and upload a replacement.`;
}

function humanizeRejectionReason(reason: string): string {
  const map: Record<string, string> = {
    wrong_date_range: "the document covers the wrong time period",
    incomplete_document: "the document appears to be incomplete or missing pages",
    unreadable_upload: "the upload was not readable (try a clearer scan or photo)",
    wrong_entity: "the document is for a different business or person",
    missing_signature: "a required signature is missing",
    wrong_document_type: "this is not the type of document we need",
    additional_clarification: "we need additional clarification",
  };
  return map[reason] ?? reason.replace(/_/g, " ");
}

function humanizeDocType(docType: string): string {
  const map: Record<string, string> = {
    BANK_STATEMENT: "Bank statement",
    TAX_RETURN_BUSINESS: "Business tax return",
    TAX_RETURN_PERSONAL: "Personal tax return",
    INCOME_STATEMENT: "Income statement",
    BALANCE_SHEET: "Balance sheet",
    RENT_ROLL: "Rent roll",
    PERSONAL_FINANCIAL_STATEMENT: "Personal financial statement",
    INSURANCE_CERTIFICATE: "Insurance certificate",
    APPRAISAL: "Appraisal report",
    LEASE_AGREEMENT: "Lease agreement",
  };
  return map[docType] ?? docType.replace(/_/g, " ").toLowerCase();
}

function computeConfidenceIndicator(evidence: EvidenceItem[]): "high" | "medium" | "low" | "none" {
  if (evidence.length === 0) return "none";
  const confidences = evidence.map((e) => e.confidence).filter((c): c is number => c != null);
  if (confidences.length === 0) return "medium";
  const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  if (avg >= 0.9) return "high";
  if (avg >= 0.7) return "medium";
  return "low";
}

function buildLastEventSummary(evidence: EvidenceItem[]): string | null {
  if (evidence.length === 0) return null;
  const latest = evidence.reduce((a, b) =>
    (a.happened_at ?? "") > (b.happened_at ?? "") ? a : b,
  );
  if (!latest.happened_at) return null;
  const ago = timeSince(latest.happened_at);
  const docLabel = latest.doc_type ? humanizeDocType(latest.doc_type) : "document";
  return `${docLabel} received ${ago}`;
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}
