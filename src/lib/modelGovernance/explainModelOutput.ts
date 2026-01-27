/**
 * Model Output Explainability (Phase H)
 *
 * Generates human-readable explanation blocks for any model output.
 * These blocks are included in audit artifacts (Phase F, Phase G)
 * to ensure every AI-generated output is traceable, bounded, and
 * understandable by a non-technical examiner.
 *
 * Invariants:
 *  - No black-box outputs
 *  - Every explanation references the model registry entry
 *  - Limitations are always disclosed
 *  - Confidence notes are always present
 */

import { getModelEntry, type ModelRegistryEntry } from "./modelRegistry";

export type ModelExplanation = {
  model_id: string;
  purpose: string;
  inputs_used: string[];
  outputs_generated: string[];
  limitations: string[];
  confidence_notes: string[];
};

/**
 * Generate an explainability block for a model invocation.
 *
 * @param modelId - The model_id from the registry
 * @param overrides - Optional overrides for context-specific explanations
 */
export function explainModelOutput(
  modelId: string,
  overrides?: {
    inputs_used?: string[];
    outputs_generated?: string[];
    confidence_notes?: string[];
  },
): ModelExplanation {
  const entry = getModelEntry(modelId);

  if (!entry) {
    return {
      model_id: modelId,
      purpose: "Unknown model — not found in governance registry.",
      inputs_used: overrides?.inputs_used ?? [],
      outputs_generated: overrides?.outputs_generated ?? [],
      limitations: [
        "This model is not registered in the governance registry.",
        "Its outputs should be treated with caution.",
      ],
      confidence_notes: overrides?.confidence_notes ?? [
        "No confidence assessment available for unregistered models.",
      ],
    };
  }

  return {
    model_id: entry.model_id,
    purpose: entry.purpose,
    inputs_used: overrides?.inputs_used ?? entry.input_scope,
    outputs_generated: overrides?.outputs_generated ?? entry.output_scope,
    limitations: getLimitations(entry),
    confidence_notes: overrides?.confidence_notes ?? getConfidenceNotes(entry),
  };
}

/**
 * Generate all model explanations for the full registry.
 * Used in the governance appendix export.
 */
export function explainAllModels(): ModelExplanation[] {
  // Import here to avoid circular dependency at module level
  const { MODEL_REGISTRY } = require("./modelRegistry");
  return (MODEL_REGISTRY as ModelRegistryEntry[]).map((entry) =>
    explainModelOutput(entry.model_id),
  );
}

// ── Internal helpers ────────────────────────────────────

function getLimitations(entry: ModelRegistryEntry): string[] {
  const base = [
    `This model (${entry.model_id}) is advisory only and cannot make autonomous decisions.`,
    "All outputs require human review and approval before being acted upon.",
    "Model outputs may contain errors — human judgment is the final authority.",
  ];

  const specific: Record<string, string[]> = {
    borrower_extraction: [
      "OCR quality directly affects extraction accuracy.",
      "Multi-entity documents may cause field confusion.",
      "EIN extraction is masked immediately — full EIN is never stored in model output.",
    ],
    financial_normalization: [
      "Financial normalization assumes standard GAAP/tax return formats.",
      "Non-standard financial statements may produce incomplete snapshots.",
      "Conflicting data sources are resolved by recency and source priority, not by AI preference.",
    ],
    risk_factor_analysis: [
      "Risk analysis is bounded by available policy chunks and rules.",
      "Policy retrieval uses semantic search which may miss exact-match rules.",
      "Confidence scores reflect model certainty, not objective risk levels.",
    ],
    pricing_recommendation: [
      "Pricing recommendations are indicative only — not binding quotes.",
      "Market benchmark data may be stale depending on data feed freshness.",
      "Risk grades are model-suggested and require underwriter confirmation.",
    ],
  };

  return [...base, ...(specific[entry.model_id] ?? [])];
}

function getConfidenceNotes(entry: ModelRegistryEntry): string[] {
  const notes: Record<string, string[]> = {
    borrower_extraction: [
      "Confidence is per-field, ranging from 0.0 to 1.0.",
      "Fields below 0.60 confidence are flagged for manual review.",
      "High confidence (>0.85) does not guarantee correctness.",
    ],
    financial_normalization: [
      "Financial completeness percentage reflects how many required metrics have values.",
      "Source type hierarchy: MANUAL > SPREAD > DOC_EXTRACT > UNKNOWN.",
      "Conflicting values are resolved deterministically, not by AI judgment.",
    ],
    risk_factor_analysis: [
      "Overall decision confidence reflects model certainty about the recommendation.",
      "Policy rule evaluation is deterministic — only narrative generation uses AI.",
      "Evidence quality depends on document completeness and extraction accuracy.",
    ],
    pricing_recommendation: [
      "Pricing confidence reflects alignment with bank policy constraints.",
      "Stress-tested scenarios use fixed parameters, not AI-generated assumptions.",
      "Final pricing must be locked by a human before becoming binding.",
    ],
  };

  return notes[entry.model_id] ?? [
    "Confidence assessment specific to this model is not available.",
    "All outputs should be reviewed by a qualified human before use.",
  ];
}

// ── Override types ──────────────────────────────────────

/**
 * Human override record for when model output is rejected.
 * Overrides are mandatory when a model recommendation is not followed.
 */
export type HumanOverride = {
  model_id: string;
  overridden_output: string;
  reason: string;
  approved_by_user_id: string;
  approved_at: string;
};
