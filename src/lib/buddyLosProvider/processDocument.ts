import "server-only";

import { CLASSIFICATION_SCHEMA_VERSION, type SpineClassificationResult } from "@/lib/classification/types";
import { classifyDocumentSpine } from "@/lib/classification/classifyDocumentSpine";
import { runGeminiOcrJob } from "@/lib/ocr/runGeminiOcrJob";
import { runMistralOcrJob } from "@/lib/ocr/runMistralOcrJob";
import {
  CONTRACT_VERSION,
  ENGINE_VERSION,
  evidenceFor,
  type ProviderRequest,
} from "./contract";

type OcrResult = { text: string; pageCount: number; model: string };

export async function processDocument(input: {
  request: ProviderRequest;
  bytes: Buffer;
  providerName: string;
}) {
  const ocr = await runOcrWithFallback(input.bytes, input.request.mediaType, input.request.documentVersionId);
  const classification = await classifyDocumentSpine(
    ocr.text,
    `${input.request.documentVersionId}.document`,
    input.request.mediaType,
  );
  const evidence = classification.evidence.map((item) =>
    evidenceFor(input.request, `${item.anchorId}: ${item.matchedText}`),
  );
  const sharedEvidence = evidence.length ? evidence : [evidenceFor(input.request, "ocr_document")];

  return {
    contractVersion: CONTRACT_VERSION,
    jobId: input.request.jobId,
    organizationId: input.request.organizationId,
    dealId: input.request.dealId,
    documentId: input.request.documentId,
    documentVersionId: input.request.documentVersionId,
    sha256: input.request.sha256,
    provider: input.providerName,
    model: ocr.model,
    engineVersion: ENGINE_VERSION,
    classification: {
      canonicalType: classification.docType,
      confidence: clampConfidence(classification.confidence),
      tier: mapTier(classification.spineTier),
      classifierVersion: classification.spineVersion || CLASSIFICATION_SCHEMA_VERSION,
      reason: classification.reason,
      requiresHumanReview: true,
      evidence: sharedEvidence,
    },
    fields: classificationFields(classification).map(([field, value]) => ({
      field,
      value,
      confidence: clampConfidence(classification.confidence),
      evidence: sharedEvidence,
    })),
    tables: [],
    completedAt: new Date().toISOString(),
  };
}

async function runOcrWithFallback(bytes: Buffer, mimeType: string, fileName: string): Promise<OcrResult> {
  try {
    return await runGeminiOcrJob({ fileBytes: bytes, mimeType, fileName });
  } catch (geminiError) {
    if (!process.env.MISTRAL_API_KEY) throw geminiError;
    return runMistralOcrJob({ fileBytes: bytes, mimeType, fileName });
  }
}

function mapTier(tier: SpineClassificationResult["spineTier"]) {
  switch (tier) {
    case "tier1_anchor": return "deterministic_anchor" as const;
    case "tier2_structural": return "deterministic_structural" as const;
    case "tier3_llm": return "ai_assist" as const;
    default: return "unclassified" as const;
  }
}

function classificationFields(result: SpineClassificationResult): Array<[string, string | number | boolean | null]> {
  const values: Array<[string, string | number | boolean | null]> = [
    ["tax_year", result.taxYear],
    ["entity_name", result.entityName],
    ["entity_type", result.entityType],
    ["form_numbers", result.formNumbers?.join(", ") ?? null],
    ["issuer", result.issuer],
    ["period_start", result.periodStart],
    ["period_end", result.periodEnd],
  ];
  return values.filter(([, value]) => value !== null && value !== "");
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
