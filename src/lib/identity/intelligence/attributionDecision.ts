/**
 * Attribution Decision Engine — Phase 2.5 (Pure)
 *
 * Provides structured suggestions for entity-binding review slots.
 * Never auto-binds. Read-only computation. Zero DB calls.
 *
 * Confidence hierarchy:
 *   HIGH: EIN exact match OR legal name exact match
 *   LOW:  partial name match
 *   null: no signal
 *
 * First matching signal wins (EIN > exact name > partial name).
 */

export type AttributionSuggestion = {
  suggestedEntityId: string;
  confidence: "HIGH" | "LOW";
  reason: string;
};

export type AttributionDecision = {
  suggestion: AttributionSuggestion | null;
};

export type AttributionEntityInput = {
  id: string;
  name: string;
  legal_name: string | null;
  ein: string | null;
};

export type AttributionDocumentSignal = {
  entity_name: string | null;
  ai_business_name: string | null;
  ai_borrower_name: string | null;
  ein_detected: string | null;
};

export function computeAttributionDecision(
  slot: { required_doc_type: string },
  entities: AttributionEntityInput[],
  documentSignals: AttributionDocumentSignal[],
): AttributionDecision {
  for (const signal of documentSignals) {
    const docName =
      signal.entity_name || signal.ai_business_name || signal.ai_borrower_name;
    const docEin = signal.ein_detected;

    // EIN exact match → HIGH
    if (docEin) {
      const einMatch = entities.find((e) => e.ein && e.ein === docEin);
      if (einMatch) {
        return {
          suggestion: {
            suggestedEntityId: einMatch.id,
            confidence: "HIGH",
            reason: "ein_exact_match",
          },
        };
      }
    }

    if (docName) {
      const normalizedDocName = docName.toLowerCase().trim();

      // Legal name exact match → HIGH
      const exactMatch = entities.find(
        (e) =>
          (e.legal_name ?? e.name).toLowerCase().trim() === normalizedDocName,
      );
      if (exactMatch) {
        return {
          suggestion: {
            suggestedEntityId: exactMatch.id,
            confidence: "HIGH",
            reason: "legal_name_exact_match",
          },
        };
      }

      // Partial name match → LOW
      const partialMatch = entities.find((e) => {
        const entityName = (e.legal_name ?? e.name).toLowerCase();
        return (
          entityName.includes(normalizedDocName) ||
          normalizedDocName.includes(entityName)
        );
      });
      if (partialMatch) {
        return {
          suggestion: {
            suggestedEntityId: partialMatch.id,
            confidence: "LOW",
            reason: "partial_name_match",
          },
        };
      }
    }
  }

  return { suggestion: null };
}
