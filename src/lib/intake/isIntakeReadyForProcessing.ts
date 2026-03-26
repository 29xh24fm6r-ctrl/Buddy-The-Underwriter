/**
 * Phase 58A — Shared Intake Readiness Gate
 *
 * Single source of truth for whether intake can advance to processing.
 * Used by intake review submit screen AND cockpit lifecycle derivation.
 * Stricter than just "no docs in UPLOADED state."
 *
 * Pure function — accepts pre-fetched document state.
 */

export type IntakeDocState = {
  id: string;
  status: string;
  classificationConfirmed: boolean;
  gatekeeperNeedsReview: boolean;
  missingYear: boolean;
  missingPeriod: boolean;
  unclassified: boolean;
};

export type IntakeReadiness = {
  ok: boolean;
  blockers: Array<{
    code: string;
    message: string;
    documentId?: string;
  }>;
};

/**
 * Determine whether intake documents are ready for processing.
 */
export function isIntakeReadyForProcessing(docs: IntakeDocState[]): IntakeReadiness {
  const blockers: IntakeReadiness["blockers"] = [];

  for (const doc of docs) {
    if (doc.unclassified) {
      blockers.push({
        code: "unclassified_document",
        message: "Document has not been classified",
        documentId: doc.id,
      });
    }

    if (!doc.classificationConfirmed && doc.status !== "confirmed") {
      blockers.push({
        code: "pending_confirmation",
        message: "Document classification has not been confirmed",
        documentId: doc.id,
      });
    }

    if (doc.gatekeeperNeedsReview) {
      blockers.push({
        code: "gatekeeper_needs_review",
        message: "Document needs gatekeeper review before processing",
        documentId: doc.id,
      });
    }

    if (doc.missingYear) {
      blockers.push({
        code: "missing_year",
        message: "Year-required document is missing year information",
        documentId: doc.id,
      });
    }

    if (doc.missingPeriod) {
      blockers.push({
        code: "missing_period",
        message: "Period-required document is missing statement period",
        documentId: doc.id,
      });
    }
  }

  return { ok: blockers.length === 0, blockers };
}
