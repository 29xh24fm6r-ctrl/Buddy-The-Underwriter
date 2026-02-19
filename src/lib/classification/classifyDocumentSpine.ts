/**
 * Buddy Institutional Classification Spine v2 — Orchestrator
 *
 * Deterministic-first, LLM-escalated, audit-safe, versioned, T12-free.
 *
 * Pipeline:
 *   Normalize → DocAI cross-validation → Tier 1 → Tier 2 → Gate → Tier 3 → Finalize
 *
 * Drop-in replacement for classifyDocument() in processArtifact.ts.
 * SpineClassificationResult is a superset of ClassificationResult.
 */

import "server-only";

import { normalizeDocument } from "./normalizeDocument";
import { runTier1Anchors } from "./tier1Anchors";
import { runTier2Structural } from "./tier2Structural";
import { applyConfidenceGate } from "./confidenceGate";
import { runTier3LLM } from "./tier3LLM";
import { extractTaxYear, extractFormNumbers } from "./textUtils";
import {
  CLASSIFICATION_SCHEMA_VERSION,
  type SpineClassificationResult,
  type SpineClassificationTier,
  type EvidenceItem,
  type DocAiSignals,
  type Tier1Result,
  type GateDecision,
  type Tier3Result,
} from "./types";

// ---------------------------------------------------------------------------
// DocAI label → Spine DocType mapping (T12-safe)
// ---------------------------------------------------------------------------

const DOCAI_LABEL_MAP: Record<string, string> = {
  tax_return_1040: "IRS_PERSONAL",
  tax_return_1120: "IRS_BUSINESS",
  tax_return_1120s: "IRS_BUSINESS",
  tax_return_1065: "IRS_BUSINESS",
  "1040": "IRS_PERSONAL",
  "1120": "IRS_BUSINESS",
  "1120s": "IRS_BUSINESS",
  "1065": "IRS_BUSINESS",
  personal_financial_statement: "PFS",
  rent_roll: "RENT_ROLL",
  // T12 prohibition: DocAI operating/income/financial → INCOME_STATEMENT
  operating_statement: "INCOME_STATEMENT",
  income_statement: "INCOME_STATEMENT",
  financial_statement: "INCOME_STATEMENT",
  balance_sheet: "BALANCE_SHEET",
  bank_statement: "BANK_STATEMENT",
  insurance_certificate: "INSURANCE",
  appraisal: "APPRAISAL",
  lease: "LEASE",
  k1: "K1",
  schedule_k1: "K1",
  w2: "W2",
  "1099": "1099",
};

function mapDocAiLabel(label: string): string | null {
  const normalized = label.toLowerCase().replace(/[\s-]+/g, "_");
  return DOCAI_LABEL_MAP[normalized] ?? null;
}

// ---------------------------------------------------------------------------
// Tier mapping for downstream compat
// ---------------------------------------------------------------------------

function mapSpineTierToLegacy(
  spineTier: SpineClassificationTier,
): "docai" | "rules" | "gemini" | "fallback" {
  switch (spineTier) {
    case "tier1_anchor":
    case "tier2_structural":
      return "rules";
    case "tier3_llm":
      return "gemini";
    case "fallback":
      return "fallback";
  }
}

// ---------------------------------------------------------------------------
// Finalize helpers
// ---------------------------------------------------------------------------

function finalizeFromTier1(
  tier1: Tier1Result,
  text: string,
): SpineClassificationResult {
  const spineTier: SpineClassificationTier = "tier1_anchor";
  return {
    docType: tier1.docType!,
    confidence: tier1.confidence,
    reason: `Tier 1 anchor: ${tier1.anchorId}`,
    taxYear: tier1.taxYear ?? extractTaxYear(text),
    entityName: null,
    entityType: tier1.entityType,
    proposedDealName: null,
    proposedDealNameSource: null,
    rawExtraction: {
      spine_tier: spineTier,
      anchor_id: tier1.anchorId,
    },
    formNumbers: tier1.formNumbers ?? extractFormNumbers(text),
    issuer: null,
    periodStart: null,
    periodEnd: null,
    tier: mapSpineTierToLegacy(spineTier),
    model: "spine:tier1_anchor",
    spineTier,
    spineVersion: CLASSIFICATION_SCHEMA_VERSION,
    evidence: tier1.evidence,
  };
}

function finalizeFromGate(
  gate: GateDecision,
  text: string,
): SpineClassificationResult {
  const spineTier: SpineClassificationTier =
    gate.source === "tier1" ? "tier1_anchor" : "tier2_structural";
  return {
    docType: gate.docType!,
    confidence: gate.confidence,
    reason:
      gate.source === "tier1"
        ? `Tier 1 anchor accepted`
        : `Tier 2 structural pattern accepted (confidence ${gate.confidence})`,
    taxYear: gate.taxYear ?? extractTaxYear(text),
    entityName: null,
    entityType: gate.entityType,
    proposedDealName: null,
    proposedDealNameSource: null,
    rawExtraction: {
      spine_tier: spineTier,
      gate_source: gate.source,
    },
    formNumbers: gate.formNumbers ?? extractFormNumbers(text),
    issuer: null,
    periodStart: null,
    periodEnd: null,
    tier: mapSpineTierToLegacy(spineTier),
    model: `spine:${spineTier}`,
    spineTier,
    spineVersion: CLASSIFICATION_SCHEMA_VERSION,
    evidence: gate.evidence,
  };
}

function finalizeFromTier3(tier3: Tier3Result): SpineClassificationResult {
  const spineTier: SpineClassificationTier = "tier3_llm";
  return {
    docType: tier3.docType,
    confidence: tier3.confidence,
    reason: tier3.reason || `Tier 3 LLM classification`,
    taxYear: tier3.taxYear,
    entityName: tier3.entityName,
    entityType: tier3.entityType,
    proposedDealName: null,
    proposedDealNameSource: null,
    rawExtraction: {
      spine_tier: spineTier,
      model: tier3.model,
      confusion_candidates: tier3.confusionCandidates,
    },
    formNumbers: tier3.formNumbers,
    issuer: tier3.issuer,
    periodStart: tier3.periodStart,
    periodEnd: tier3.periodEnd,
    tier: mapSpineTierToLegacy(spineTier),
    model: tier3.model,
    spineTier,
    spineVersion: CLASSIFICATION_SCHEMA_VERSION,
    evidence: tier3.evidence,
    confusionCandidates: tier3.confusionCandidates,
  };
}

function finalizeFallback(text: string): SpineClassificationResult {
  const spineTier: SpineClassificationTier = "fallback";
  return {
    docType: "OTHER",
    confidence: 0.1,
    reason: "All classification tiers failed — fallback to OTHER",
    taxYear: extractTaxYear(text),
    entityName: null,
    entityType: null,
    proposedDealName: null,
    proposedDealNameSource: null,
    rawExtraction: { spine_tier: spineTier },
    formNumbers: extractFormNumbers(text),
    issuer: null,
    periodStart: null,
    periodEnd: null,
    tier: "fallback",
    model: "spine:fallback",
    spineTier,
    spineVersion: CLASSIFICATION_SCHEMA_VERSION,
    evidence: [],
  };
}

function finalizeFromDocAi(
  docType: string,
  docAi: DocAiSignals,
  text: string,
  tier1FormNumbers: string[] | null,
  tier1EntityType: "business" | "personal" | null,
  tier1TaxYear: number | null,
): SpineClassificationResult {
  // DocAI results map to legacy "docai" tier for compat
  const spineTier: SpineClassificationTier = "tier1_anchor";
  const evidence: EvidenceItem[] = [
    {
      type: "docai_signal",
      anchorId: `docai:${docAi.processorType ?? "unknown"}`,
      matchedText: docAi.docTypeLabel ?? "",
      confidence: docAi.docTypeConfidence ?? 0,
    },
  ];

  return {
    docType,
    confidence: docAi.docTypeConfidence ?? 0.8,
    reason: `DocAI processor classified as "${docAi.docTypeLabel}" (confidence ${docAi.docTypeConfidence})`,
    taxYear: tier1TaxYear ?? extractTaxYear(text),
    entityName: null,
    entityType: tier1EntityType,
    proposedDealName: null,
    proposedDealNameSource: null,
    rawExtraction: {
      spine_tier: "docai_cross_validated",
      docai_label: docAi.docTypeLabel,
      docai_confidence: docAi.docTypeConfidence,
      docai_processor: docAi.processorType,
    },
    formNumbers: tier1FormNumbers ?? extractFormNumbers(text),
    issuer: null,
    periodStart: null,
    periodEnd: null,
    tier: "docai",
    model: `docai:${docAi.processorType ?? "unknown"}`,
    spineTier,
    spineVersion: CLASSIFICATION_SCHEMA_VERSION,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a document using the Buddy Institutional Classification Spine v2.
 *
 * Pipeline: Normalize → DocAI check → Tier 1 → Tier 2 → Gate → Tier 3 → Finalize
 *
 * Drop-in replacement for classifyDocument(). Never throws.
 */
export async function classifyDocumentSpine(
  documentText: string,
  filename: string,
  mimeType: string | null,
  docAi?: DocAiSignals,
): Promise<SpineClassificationResult> {
  try {
    // ── Step 1: Normalize ─────────────────────────────────────────────
    const doc = normalizeDocument("spine", documentText, filename, mimeType);

    // ── Step 2: Tier 1 — Deterministic Anchors ────────────────────────
    const tier1 = runTier1Anchors(doc);

    // ── Step 3: DocAI cross-validation ────────────────────────────────
    // If DocAI signals are available and high confidence, use them —
    // but Tier 1 text evidence (≥0.90) always overrides DocAI if they disagree.
    if (docAi?.docTypeLabel && (docAi.docTypeConfidence ?? 0) >= 0.75) {
      const mappedDocAiType = mapDocAiLabel(docAi.docTypeLabel);

      if (mappedDocAiType) {
        // Cross-validation: Tier 1 anchor (≥0.90) beats DocAI
        if (tier1.matched && tier1.docType !== mappedDocAiType) {
          return finalizeFromTier1(tier1, documentText);
        }

        // Tier 1 agrees with DocAI, or Tier 1 didn't match — use DocAI
        if (!tier1.matched || tier1.docType === mappedDocAiType) {
          return finalizeFromDocAi(
            mappedDocAiType,
            docAi,
            documentText,
            tier1.formNumbers,
            tier1.entityType,
            tier1.taxYear,
          );
        }
      }
    }

    // ── Step 4: Tier 1 matched (no DocAI or DocAI unmapped) → accept ──
    if (tier1.matched) {
      return finalizeFromTier1(tier1, documentText);
    }

    // ── Step 5: Tier 2 — Structural Patterns ──────────────────────────
    const tier2 = runTier2Structural(doc);

    // ── Step 6: Confidence Gate ───────────────────────────────────────
    const gate = applyConfidenceGate(tier1, tier2);
    if (gate.accepted) {
      return finalizeFromGate(gate, documentText);
    }

    // ── Step 7: Tier 3 — Domain LLM Escalation ───────────────────────
    const tier3 = await runTier3LLM(doc);
    if (tier3.matched) {
      return finalizeFromTier3(tier3);
    }

    // ── Step 8: Fallback ──────────────────────────────────────────────
    return finalizeFallback(documentText);
  } catch (error: any) {
    console.error("[classifyDocumentSpine] Unexpected error — fallback", {
      filename,
      error: error?.message,
    });
    return finalizeFallback(documentText);
  }
}
