import type { SpineClassificationResult } from "@/lib/classification/types";
import { resolveDocTyping } from "@/lib/docs/typing/resolveDocTyping";
import { BORROWER_DOCUMENT_TYPES } from "./admission";
import { z } from "zod";

export const ClarificationSchema = z.object({
  doc_type: z.enum(BORROWER_DOCUMENT_TYPES.map(([type]) => type) as [string, ...string[]]),
  tax_year: z.number().int().min(1990).max(2100).nullable().default(null),
  statement_period: z.enum(["YTD", "ANNUAL", "CURRENT", "HISTORICAL"]).nullable().default(null),
  ownership_entity_id: z.string().uuid().nullable().default(null),
}).strict();

/** Preserve detected form guardrails and keep borrower assertions distinct from AI evidence. */
export function applyDocumentClarification(classification: SpineClassificationResult, input: unknown): SpineClassificationResult {
  const answer = ClarificationSchema.parse(input);
  const typing = resolveDocTyping({
    aiDocType: answer.doc_type, aiTaxYear: answer.tax_year,
    aiStatementPeriod: answer.statement_period,
    aiFormNumbers: classification.formNumbers, aiConfidence: 1,
    aiEntityType: classification.entityType,
  });
  if (typing.guardrail_applied) throw new Error("The selected document type conflicts with the form number on the file. Please check the document.");
  return {
    ...classification,
    docType: answer.doc_type, taxYear: answer.tax_year ?? classification.taxYear,
    confidence: 1,
    reason: "Document type confirmed by borrower; financial contents remain subject to extraction and validation.",
    model: "borrower_clarification",
    rawExtraction: { ...classification.rawExtraction, borrower_clarification: answer, prior_classifier_confidence: classification.confidence },
  };
}
