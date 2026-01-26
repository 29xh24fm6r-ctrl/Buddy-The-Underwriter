/**
 * Mission Integrity Assertions
 *
 * Runtime integrity checks for research missions.
 * These assertions ensure bank-grade auditability:
 * - No mission completes without sources
 * - No inference without input_fact_ids
 * - No narrative sentence without citations
 * - Complete audit trail
 *
 * These are non-throwing by default - they log and return ok:false
 * to allow graceful degradation.
 */

import type {
  ResearchMission,
  ResearchSource,
  ResearchFact,
  ResearchInference,
  NarrativeSection,
  NarrativeSentence,
} from "./types";

// ============================================================================
// Types
// ============================================================================

export type IntegrityViolation = {
  code: IntegrityViolationCode;
  message: string;
  severity: "error" | "warning";
  context?: Record<string, unknown>;
};

export type IntegrityViolationCode =
  | "NO_SOURCES"
  | "NO_FACTS"
  | "NO_INFERENCES"
  | "ORPHAN_INFERENCE"
  | "UNCITED_SENTENCE"
  | "ORPHAN_CITATION"
  | "MISSING_CHECKSUM"
  | "MISSING_RETRIEVED_AT"
  | "MISSING_RATIONALE"
  | "INCOMPLETE_AUDIT_TRAIL";

export type MissionIntegrityResult = {
  ok: boolean;
  mission_id: string;
  violations: IntegrityViolation[];
  warnings: IntegrityViolation[];
  /** Summary of what was checked */
  summary: {
    sources_count: number;
    facts_count: number;
    inferences_count: number;
    narrative_sections_count: number;
    total_sentences: number;
    total_citations: number;
  };
};

export type MissionData = {
  mission: ResearchMission;
  sources: ResearchSource[];
  facts: ResearchFact[];
  inferences: ResearchInference[];
  narrative?: NarrativeSection[];
};

// ============================================================================
// Main Integrity Assertion
// ============================================================================

/**
 * Assert mission integrity.
 * Returns ok:false with violations instead of throwing.
 * This allows graceful degradation and logging.
 */
export function assertMissionIntegrity(data: MissionData): MissionIntegrityResult {
  const violations: IntegrityViolation[] = [];
  const warnings: IntegrityViolation[] = [];

  const { mission, sources, facts, inferences, narrative } = data;

  // 1. Source integrity checks
  checkSourceIntegrity(sources, violations, warnings);

  // 2. Fact integrity checks (only if we have sources)
  if (sources.length > 0) {
    checkFactIntegrity(facts, sources, violations, warnings);
  }

  // 3. Inference integrity checks
  checkInferenceIntegrity(inferences, facts, violations, warnings);

  // 4. Narrative integrity checks
  const narrativeSections = narrative ?? [];
  checkNarrativeIntegrity(narrativeSections, facts, inferences, violations, warnings);

  // 5. Audit trail checks
  checkAuditTrail(mission, sources, violations, warnings);

  // Calculate summary
  let totalSentences = 0;
  let totalCitations = 0;
  for (const section of narrativeSections) {
    totalSentences += section.sentences.length;
    for (const sentence of section.sentences) {
      totalCitations += sentence.citations.length;
    }
  }

  const summary = {
    sources_count: sources.length,
    facts_count: facts.length,
    inferences_count: inferences.length,
    narrative_sections_count: narrativeSections.length,
    total_sentences: totalSentences,
    total_citations: totalCitations,
  };

  return {
    ok: violations.length === 0,
    mission_id: mission.id,
    violations,
    warnings,
    summary,
  };
}

// ============================================================================
// Source Integrity
// ============================================================================

function checkSourceIntegrity(
  sources: ResearchSource[],
  violations: IntegrityViolation[],
  warnings: IntegrityViolation[]
): void {
  // Must have at least one source
  if (sources.length === 0) {
    violations.push({
      code: "NO_SOURCES",
      message: "Mission has no sources",
      severity: "error",
    });
    return;
  }

  // Each source must have checksum and retrieved_at
  for (const source of sources) {
    if (!source.checksum) {
      violations.push({
        code: "MISSING_CHECKSUM",
        message: `Source ${source.id} missing checksum`,
        severity: "error",
        context: { source_id: source.id, source_name: source.source_name },
      });
    }

    if (!source.retrieved_at) {
      violations.push({
        code: "MISSING_RETRIEVED_AT",
        message: `Source ${source.id} missing retrieved_at`,
        severity: "error",
        context: { source_id: source.id, source_name: source.source_name },
      });
    }

    // Warn if source has fetch error but was still included
    if (source.fetch_error) {
      warnings.push({
        code: "INCOMPLETE_AUDIT_TRAIL",
        message: `Source ${source.id} has fetch error: ${source.fetch_error}`,
        severity: "warning",
        context: { source_id: source.id, fetch_error: source.fetch_error },
      });
    }
  }
}

// ============================================================================
// Fact Integrity
// ============================================================================

function checkFactIntegrity(
  facts: ResearchFact[],
  sources: ResearchSource[],
  violations: IntegrityViolation[],
  warnings: IntegrityViolation[]
): void {
  // It's okay to have no facts if sources returned empty data
  // But warn about it
  if (facts.length === 0) {
    warnings.push({
      code: "NO_FACTS",
      message: "Mission has no facts extracted from sources",
      severity: "warning",
    });
    return;
  }

  const sourceIds = new Set(sources.map((s) => s.id));

  // Each fact must reference a valid source
  for (const fact of facts) {
    if (!sourceIds.has(fact.source_id)) {
      violations.push({
        code: "ORPHAN_CITATION",
        message: `Fact ${fact.id} references unknown source ${fact.source_id}`,
        severity: "error",
        context: { fact_id: fact.id, source_id: fact.source_id },
      });
    }
  }
}

// ============================================================================
// Inference Integrity
// ============================================================================

function checkInferenceIntegrity(
  inferences: ResearchInference[],
  facts: ResearchFact[],
  violations: IntegrityViolation[],
  warnings: IntegrityViolation[]
): void {
  // It's okay to have no inferences if we have insufficient facts
  if (inferences.length === 0) {
    if (facts.length >= 3) {
      warnings.push({
        code: "NO_INFERENCES",
        message: "Mission has facts but no inferences derived",
        severity: "warning",
      });
    }
    return;
  }

  const factIds = new Set(facts.map((f) => f.id));

  // Each inference must have input_fact_ids
  for (const inference of inferences) {
    if (!inference.input_fact_ids || inference.input_fact_ids.length === 0) {
      violations.push({
        code: "ORPHAN_INFERENCE",
        message: `Inference ${inference.id} has no input_fact_ids`,
        severity: "error",
        context: { inference_id: inference.id, inference_type: inference.inference_type },
      });
      continue;
    }

    // Check that all input facts exist
    for (const factId of inference.input_fact_ids) {
      if (!factIds.has(factId)) {
        violations.push({
          code: "ORPHAN_CITATION",
          message: `Inference ${inference.id} references unknown fact ${factId}`,
          severity: "error",
          context: { inference_id: inference.id, fact_id: factId },
        });
      }
    }

    // Warn if no reasoning provided
    if (!inference.reasoning) {
      warnings.push({
        code: "MISSING_RATIONALE",
        message: `Inference ${inference.id} missing reasoning`,
        severity: "warning",
        context: { inference_id: inference.id },
      });
    }
  }
}

// ============================================================================
// Narrative Integrity
// ============================================================================

function checkNarrativeIntegrity(
  sections: NarrativeSection[],
  facts: ResearchFact[],
  inferences: ResearchInference[],
  violations: IntegrityViolation[],
  warnings: IntegrityViolation[]
): void {
  // Empty narrative is okay if we have no data
  if (sections.length === 0) {
    return;
  }

  const factIds = new Set(facts.map((f) => f.id));
  const inferenceIds = new Set(inferences.map((i) => i.id));

  for (const section of sections) {
    for (const sentence of section.sentences) {
      // Check for uncited sentences
      // Allow header-like sentences (end with ":" or are very short)
      const isHeader = sentence.text.endsWith(":") || sentence.text.length < 30;

      if (sentence.citations.length === 0 && !isHeader) {
        // Not a violation for short header sentences
        if (sentence.text.length > 50) {
          violations.push({
            code: "UNCITED_SENTENCE",
            message: `Uncited sentence in section "${section.title}": "${sentence.text.slice(0, 50)}..."`,
            severity: "error",
            context: { section_title: section.title, sentence_preview: sentence.text.slice(0, 100) },
          });
        } else {
          warnings.push({
            code: "UNCITED_SENTENCE",
            message: `Short uncited sentence in section "${section.title}": "${sentence.text}"`,
            severity: "warning",
            context: { section_title: section.title },
          });
        }
      }

      // Check citation validity
      for (const citation of sentence.citations) {
        if (citation.type === "fact" && !factIds.has(citation.id)) {
          violations.push({
            code: "ORPHAN_CITATION",
            message: `Sentence cites unknown fact ${citation.id}`,
            severity: "error",
            context: { citation_type: "fact", citation_id: citation.id },
          });
        }

        if (citation.type === "inference" && !inferenceIds.has(citation.id)) {
          violations.push({
            code: "ORPHAN_CITATION",
            message: `Sentence cites unknown inference ${citation.id}`,
            severity: "error",
            context: { citation_type: "inference", citation_id: citation.id },
          });
        }
      }
    }
  }
}

// ============================================================================
// Audit Trail
// ============================================================================

function checkAuditTrail(
  mission: ResearchMission,
  sources: ResearchSource[],
  violations: IntegrityViolation[],
  warnings: IntegrityViolation[]
): void {
  // Mission must have timestamps
  if (!mission.created_at) {
    violations.push({
      code: "INCOMPLETE_AUDIT_TRAIL",
      message: "Mission missing created_at timestamp",
      severity: "error",
    });
  }

  if (mission.status === "complete" && !mission.completed_at) {
    warnings.push({
      code: "INCOMPLETE_AUDIT_TRAIL",
      message: "Completed mission missing completed_at timestamp",
      severity: "warning",
    });
  }

  // Check source fetch durations
  for (const source of sources) {
    if (source.fetch_duration_ms === undefined || source.fetch_duration_ms === null) {
      warnings.push({
        code: "INCOMPLETE_AUDIT_TRAIL",
        message: `Source ${source.id} missing fetch_duration_ms`,
        severity: "warning",
        context: { source_id: source.id },
      });
    }
  }
}

// ============================================================================
// Bulk Integrity Check
// ============================================================================

/**
 * Check integrity of multiple missions.
 */
export function assertBulkMissionIntegrity(
  missions: MissionData[]
): { ok: boolean; results: MissionIntegrityResult[] } {
  const results = missions.map(assertMissionIntegrity);
  const ok = results.every((r) => r.ok);
  return { ok, results };
}

// ============================================================================
// Explainability Graph Validation
// ============================================================================

export type ExplainabilityNode = {
  id: string;
  type: "source" | "fact" | "inference" | "sentence";
  label: string;
};

export type ExplainabilityEdge = {
  from: string;
  to: string;
  type: "extracted_from" | "derived_from" | "cited_by";
};

export type ExplainabilityGraph = {
  nodes: ExplainabilityNode[];
  edges: ExplainabilityEdge[];
};

/**
 * Build explainability graph from mission data.
 */
export function buildExplainabilityGraph(data: MissionData): ExplainabilityGraph {
  const { sources, facts, inferences, narrative } = data;
  const nodes: ExplainabilityNode[] = [];
  const edges: ExplainabilityEdge[] = [];

  // Add source nodes
  for (const source of sources) {
    nodes.push({
      id: source.id,
      type: "source",
      label: source.source_name,
    });
  }

  // Add fact nodes and edges to sources
  for (const fact of facts) {
    nodes.push({
      id: fact.id,
      type: "fact",
      label: `${fact.fact_type}`,
    });
    edges.push({
      from: fact.source_id,
      to: fact.id,
      type: "extracted_from",
    });
  }

  // Add inference nodes and edges to facts
  for (const inference of inferences) {
    nodes.push({
      id: inference.id,
      type: "inference",
      label: inference.inference_type,
    });
    for (const factId of inference.input_fact_ids) {
      edges.push({
        from: factId,
        to: inference.id,
        type: "derived_from",
      });
    }
  }

  // Add sentence nodes and edges to citations
  let sentenceIndex = 0;
  for (const section of narrative ?? []) {
    for (const sentence of section.sentences) {
      const sentenceId = `sentence-${sentenceIndex}`;
      nodes.push({
        id: sentenceId,
        type: "sentence",
        label: sentence.text.slice(0, 50),
      });
      for (const citation of sentence.citations) {
        edges.push({
          from: citation.id,
          to: sentenceId,
          type: "cited_by",
        });
      }
      sentenceIndex++;
    }
  }

  return { nodes, edges };
}

/**
 * Validate explainability graph for orphan edges.
 */
export function validateExplainabilityGraph(graph: ExplainabilityGraph): {
  valid: boolean;
  orphanEdges: ExplainabilityEdge[];
} {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const orphanEdges: ExplainabilityEdge[] = [];

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      orphanEdges.push(edge);
    }
  }

  return {
    valid: orphanEdges.length === 0,
    orphanEdges,
  };
}
