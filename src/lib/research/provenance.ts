/**
 * Data Provenance Scoring
 *
 * Per-source trust weights flow into fact/inference confidence.
 * This creates a verifiable chain of trust from source → fact → inference.
 *
 * Trust factors:
 * - Source class trust score (government = 0.95, news = 0.6)
 * - Source freshness (more recent = higher weight)
 * - Extraction method (rule = 0.95, model = 0.8)
 * - Citation chain depth (fewer hops = higher trust)
 */

import type { ResearchSource, ResearchFact, ResearchInference } from "./types";
import { getSourceTrustScore } from "./sources/registry";

// ============================================================================
// Types
// ============================================================================

export type ProvenanceScore = {
  /** Overall trust score (0-1) */
  score: number;
  /** Breakdown of contributing factors */
  factors: ProvenanceFactor[];
  /** Chain of trust from source to this item */
  trust_chain: TrustChainNode[];
  /** Human-readable explanation */
  explanation: string;
};

export type ProvenanceFactor = {
  name: string;
  weight: number;
  value: number;
  contribution: number; // weight * value
};

export type TrustChainNode = {
  id: string;
  type: "source" | "fact" | "inference";
  trust_score: number;
  label: string;
};

export type SourceProvenance = {
  source_id: string;
  source_name: string;
  source_class: string;
  base_trust: number;
  freshness_factor: number;
  final_trust: number;
};

export type FactProvenance = {
  fact_id: string;
  fact_type: string;
  source_provenance: SourceProvenance;
  extraction_factor: number;
  final_confidence: number;
  original_confidence: number;
  adjusted_confidence: number;
};

export type InferenceProvenance = {
  inference_id: string;
  inference_type: string;
  input_fact_provenances: FactProvenance[];
  chain_depth: number;
  aggregated_trust: number;
  original_confidence: number;
  adjusted_confidence: number;
};

// ============================================================================
// Constants
// ============================================================================

/** Weight factors for provenance calculation */
const PROVENANCE_WEIGHTS = {
  source_trust: 0.4,
  freshness: 0.2,
  extraction_method: 0.25,
  chain_depth: 0.15,
};

/** Extraction method trust factors */
const EXTRACTION_TRUST = {
  rule: 0.95,
  model: 0.80,
};

/** Freshness decay - data older than this is penalized */
const FRESHNESS_DECAY_DAYS = 365;

/** Chain depth penalty - each hop reduces trust */
const CHAIN_DEPTH_PENALTY = 0.05;

// ============================================================================
// Source Provenance
// ============================================================================

/**
 * Calculate provenance score for a source.
 */
export function calculateSourceProvenance(source: ResearchSource): SourceProvenance {
  // Base trust from registry
  const baseTrust = getSourceTrustScore(source.source_url);

  // Freshness factor (penalize old data)
  const retrievedAt = new Date(source.retrieved_at);
  const ageInDays = (Date.now() - retrievedAt.getTime()) / (1000 * 60 * 60 * 24);
  const freshnessFactor = Math.max(0.5, 1 - (ageInDays / FRESHNESS_DECAY_DAYS) * 0.5);

  // Final trust = base * freshness
  const finalTrust = baseTrust * freshnessFactor;

  return {
    source_id: source.id,
    source_name: source.source_name,
    source_class: source.source_class,
    base_trust: baseTrust,
    freshness_factor: freshnessFactor,
    final_trust: finalTrust,
  };
}

// ============================================================================
// Fact Provenance
// ============================================================================

/**
 * Calculate provenance score for a fact.
 */
export function calculateFactProvenance(
  fact: ResearchFact,
  source: ResearchSource
): FactProvenance {
  const sourceProvenance = calculateSourceProvenance(source);

  // Extraction method factor
  const extractionFactor = EXTRACTION_TRUST[fact.extracted_by] ?? 0.7;

  // Combine source trust with extraction method
  const adjustedConfidence =
    fact.confidence *
    (PROVENANCE_WEIGHTS.source_trust * sourceProvenance.final_trust +
      PROVENANCE_WEIGHTS.extraction_method * extractionFactor +
      (1 - PROVENANCE_WEIGHTS.source_trust - PROVENANCE_WEIGHTS.extraction_method));

  return {
    fact_id: fact.id,
    fact_type: fact.fact_type,
    source_provenance: sourceProvenance,
    extraction_factor: extractionFactor,
    final_confidence: adjustedConfidence,
    original_confidence: fact.confidence,
    adjusted_confidence: adjustedConfidence,
  };
}

// ============================================================================
// Inference Provenance
// ============================================================================

/**
 * Calculate provenance score for an inference.
 */
export function calculateInferenceProvenance(
  inference: ResearchInference,
  facts: ResearchFact[],
  sources: ResearchSource[]
): InferenceProvenance {
  // Build source lookup
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  // Calculate provenance for each input fact
  const inputFactProvenances: FactProvenance[] = [];
  for (const factId of inference.input_fact_ids) {
    const fact = facts.find((f) => f.id === factId);
    if (fact) {
      const source = sourceMap.get(fact.source_id);
      if (source) {
        inputFactProvenances.push(calculateFactProvenance(fact, source));
      }
    }
  }

  // Chain depth = 2 (source → fact → inference)
  const chainDepth = 2;
  const chainDepthPenalty = 1 - (chainDepth - 1) * CHAIN_DEPTH_PENALTY;

  // Aggregate trust from input facts (weighted average)
  let aggregatedTrust = 0;
  if (inputFactProvenances.length > 0) {
    const totalWeight = inputFactProvenances.reduce(
      (sum, fp) => sum + fp.adjusted_confidence,
      0
    );
    aggregatedTrust = totalWeight / inputFactProvenances.length;
  }

  // Apply chain depth penalty
  const adjustedConfidence = inference.confidence * aggregatedTrust * chainDepthPenalty;

  return {
    inference_id: inference.id,
    inference_type: inference.inference_type,
    input_fact_provenances: inputFactProvenances,
    chain_depth: chainDepth,
    aggregated_trust: aggregatedTrust,
    original_confidence: inference.confidence,
    adjusted_confidence: Math.min(adjustedConfidence, inference.confidence), // Never boost above original
  };
}

// ============================================================================
// Full Provenance Report
// ============================================================================

export type ProvenanceReport = {
  sources: SourceProvenance[];
  facts: FactProvenance[];
  inferences: InferenceProvenance[];
  summary: {
    avg_source_trust: number;
    avg_fact_confidence: number;
    avg_inference_confidence: number;
    lowest_trust_source?: SourceProvenance;
    highest_trust_source?: SourceProvenance;
  };
};

/**
 * Generate a full provenance report for mission data.
 */
export function generateProvenanceReport(
  sources: ResearchSource[],
  facts: ResearchFact[],
  inferences: ResearchInference[]
): ProvenanceReport {
  // Calculate source provenances
  const sourceProvenances = sources.map(calculateSourceProvenance);

  // Build source lookup
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  // Calculate fact provenances
  const factProvenances: FactProvenance[] = [];
  for (const fact of facts) {
    const source = sourceMap.get(fact.source_id);
    if (source) {
      factProvenances.push(calculateFactProvenance(fact, source));
    }
  }

  // Calculate inference provenances
  const inferenceProvenances = inferences.map((inf) =>
    calculateInferenceProvenance(inf, facts, sources)
  );

  // Calculate summary statistics
  const avgSourceTrust =
    sourceProvenances.length > 0
      ? sourceProvenances.reduce((sum, sp) => sum + sp.final_trust, 0) /
        sourceProvenances.length
      : 0;

  const avgFactConfidence =
    factProvenances.length > 0
      ? factProvenances.reduce((sum, fp) => sum + fp.adjusted_confidence, 0) /
        factProvenances.length
      : 0;

  const avgInferenceConfidence =
    inferenceProvenances.length > 0
      ? inferenceProvenances.reduce((sum, ip) => sum + ip.adjusted_confidence, 0) /
        inferenceProvenances.length
      : 0;

  const sortedByTrust = [...sourceProvenances].sort(
    (a, b) => a.final_trust - b.final_trust
  );

  return {
    sources: sourceProvenances,
    facts: factProvenances,
    inferences: inferenceProvenances,
    summary: {
      avg_source_trust: avgSourceTrust,
      avg_fact_confidence: avgFactConfidence,
      avg_inference_confidence: avgInferenceConfidence,
      lowest_trust_source: sortedByTrust[0],
      highest_trust_source: sortedByTrust[sortedByTrust.length - 1],
    },
  };
}

// ============================================================================
// Trust Chain Visualization
// ============================================================================

/**
 * Build a trust chain for an inference.
 */
export function buildTrustChain(
  inference: ResearchInference,
  facts: ResearchFact[],
  sources: ResearchSource[]
): TrustChainNode[] {
  const chain: TrustChainNode[] = [];
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const factMap = new Map(facts.map((f) => [f.id, f]));

  // Add input facts and their sources
  for (const factId of inference.input_fact_ids) {
    const fact = factMap.get(factId);
    if (fact) {
      const source = sourceMap.get(fact.source_id);
      if (source) {
        const sourceProvenance = calculateSourceProvenance(source);
        const factProvenance = calculateFactProvenance(fact, source);

        // Add source node if not already present
        if (!chain.some((n) => n.id === source.id)) {
          chain.push({
            id: source.id,
            type: "source",
            trust_score: sourceProvenance.final_trust,
            label: source.source_name,
          });
        }

        // Add fact node
        chain.push({
          id: fact.id,
          type: "fact",
          trust_score: factProvenance.adjusted_confidence,
          label: fact.fact_type,
        });
      }
    }
  }

  // Add inference node
  const inferenceProvenance = calculateInferenceProvenance(inference, facts, sources);
  chain.push({
    id: inference.id,
    type: "inference",
    trust_score: inferenceProvenance.adjusted_confidence,
    label: inference.inference_type,
  });

  return chain;
}

// ============================================================================
// Human-Readable Explanation
// ============================================================================

/**
 * Generate a human-readable provenance explanation for an inference.
 */
export function explainProvenance(
  inference: ResearchInference,
  facts: ResearchFact[],
  sources: ResearchSource[]
): string {
  const provenance = calculateInferenceProvenance(inference, facts, sources);
  const lines: string[] = [];

  lines.push(`**Provenance Analysis for ${inference.inference_type}**`);
  lines.push("");

  // Original vs adjusted confidence
  lines.push(
    `- Original confidence: ${(provenance.original_confidence * 100).toFixed(0)}%`
  );
  lines.push(
    `- Adjusted confidence: ${(provenance.adjusted_confidence * 100).toFixed(0)}%`
  );
  lines.push("");

  // Input facts breakdown
  lines.push(`**Input Facts (${provenance.input_fact_provenances.length}):**`);
  for (const fp of provenance.input_fact_provenances) {
    lines.push(
      `- ${fp.fact_type}: ${(fp.adjusted_confidence * 100).toFixed(0)}% confidence`
    );
    lines.push(
      `  - Source: ${fp.source_provenance.source_name} (${fp.source_provenance.source_class})`
    );
    lines.push(
      `  - Source trust: ${(fp.source_provenance.final_trust * 100).toFixed(0)}%`
    );
    lines.push(`  - Extraction: ${fp.extraction_factor === 0.95 ? "rule-based" : "model-based"}`);
  }

  return lines.join("\n");
}
