/**
 * Conflict Resolver
 *
 * When two authoritative sources disagree on the same fact, we:
 * 1. Detect the conflict automatically
 * 2. Preserve BOTH facts (never discard data)
 * 3. Generate a human-readable explanation
 * 4. Let the underwriter make the final call
 *
 * This is critical for bank-grade auditability - we never silently
 * choose one source over another.
 */

import type { ResearchFact, ResearchSource, FactValue, FactType } from "./types";
import { getSourceTrustScore } from "./sources/registry";

// ============================================================================
// Types
// ============================================================================

export type ConflictType =
  | "numeric_disagreement"      // Two sources report different numbers
  | "categorical_disagreement"  // Two sources report different categories
  | "temporal_disagreement"     // Two sources report different time periods
  | "directional_disagreement"; // Two sources disagree on trend direction

export type ConflictSeverity = "low" | "medium" | "high";

export type FactConflict = {
  id: string;
  conflict_type: ConflictType;
  severity: ConflictSeverity;
  fact_type: string;
  facts: ConflictingFact[];
  explanation: string;
  recommendation: ConflictRecommendation;
  created_at: string;
};

export type ConflictingFact = {
  fact_id: string;
  source_id: string;
  source_name: string;
  source_class: string;
  source_trust: number;
  value: FactValue;
  confidence: number;
  extracted_at: string; // Maps to ResearchFact.extracted_at
};

export type ConflictRecommendation =
  | "prefer_higher_trust"     // One source is clearly more authoritative
  | "prefer_more_recent"      // One source has more recent data
  | "manual_review"           // Banker should review both
  | "average_values"          // For numeric values, averaging may be appropriate
  | "flag_for_verification";  // Recommend verifying with borrower

export type ConflictResolution = {
  conflict_id: string;
  resolution_type: "accepted" | "rejected" | "manual_override";
  chosen_fact_id?: string;
  override_value?: FactValue;
  rationale: string;
  resolved_by: string;
  resolved_at: string;
};

export type ConflictReport = {
  ok: boolean;
  conflicts: FactConflict[];
  summary: ConflictSummary;
  error?: string;
};

export type ConflictSummary = {
  total_conflicts: number;
  high_severity: number;
  medium_severity: number;
  low_severity: number;
  by_fact_type: Record<string, number>;
  requires_manual_review: number;
};

// ============================================================================
// Constants
// ============================================================================

/** Threshold for numeric disagreement (percentage difference) */
const NUMERIC_DISAGREEMENT_THRESHOLD = 0.1; // 10%

/** Threshold for high severity numeric disagreement */
const HIGH_SEVERITY_THRESHOLD = 0.25; // 25%

/** Trust score difference to auto-recommend higher trust source */
const TRUST_PREFERENCE_THRESHOLD = 0.15; // 15% difference

/** Fact types that can have numeric conflicts */
const NUMERIC_FACT_TYPES = [
  "market_size",
  "growth_rate",
  "employment_count",
  "average_wage",
  "establishment_count",
  "revenue",
  "profit_margin",
];

/** Fact types with categorical values */
const CATEGORICAL_FACT_TYPES = [
  "industry_classification",
  "regulatory_status",
  "market_segment",
  "competitive_position",
];

/** Fact types with directional values (increasing/decreasing) */
const DIRECTIONAL_FACT_TYPES = [
  "growth_trend",
  "employment_trend",
  "demand_trend",
  "price_trend",
];

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Detect all conflicts in a set of facts.
 */
export function detectConflicts(
  facts: ResearchFact[],
  sources: ResearchSource[]
): ConflictReport {
  const conflicts: FactConflict[] = [];
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  // Group facts by type
  const factsByType = groupFactsByType(facts);

  // Check each fact type for conflicts
  for (const [factType, typeFacts] of factsByType) {
    if (typeFacts.length < 2) continue;

    // Compare all pairs of facts
    for (let i = 0; i < typeFacts.length; i++) {
      for (let j = i + 1; j < typeFacts.length; j++) {
        const fact1 = typeFacts[i];
        const fact2 = typeFacts[j];

        const conflict = detectFactConflict(fact1, fact2, sourceMap);
        if (conflict) {
          // Check if we already have this conflict (avoid duplicates)
          const existingConflict = conflicts.find(
            (c) =>
              c.fact_type === conflict.fact_type &&
              c.facts.some((f) => f.fact_id === fact1.id) &&
              c.facts.some((f) => f.fact_id === fact2.id)
          );
          if (!existingConflict) {
            conflicts.push(conflict);
          }
        }
      }
    }
  }

  // Calculate summary
  const summary = calculateConflictSummary(conflicts);

  return {
    ok: true,
    conflicts,
    summary,
  };
}

/**
 * Detect conflict between two specific facts.
 */
export function detectFactConflict(
  fact1: ResearchFact,
  fact2: ResearchFact,
  sourceMap: Map<string, ResearchSource>
): FactConflict | null {
  // Must be same fact type to conflict
  if (fact1.fact_type !== fact2.fact_type) {
    return null;
  }

  const source1 = sourceMap.get(fact1.source_id);
  const source2 = sourceMap.get(fact2.source_id);

  if (!source1 || !source2) {
    return null;
  }

  // Check for conflict based on fact type
  let conflictType: ConflictType | null = null;
  let severity: ConflictSeverity = "low";

  if (NUMERIC_FACT_TYPES.includes(fact1.fact_type)) {
    const numericResult = checkNumericConflict(fact1.value, fact2.value);
    if (numericResult) {
      conflictType = "numeric_disagreement";
      severity = numericResult.severity;
    }
  } else if (CATEGORICAL_FACT_TYPES.includes(fact1.fact_type)) {
    if (checkCategoricalConflict(fact1.value, fact2.value)) {
      conflictType = "categorical_disagreement";
      severity = "medium";
    }
  } else if (DIRECTIONAL_FACT_TYPES.includes(fact1.fact_type)) {
    if (checkDirectionalConflict(fact1.value, fact2.value)) {
      conflictType = "directional_disagreement";
      severity = "high"; // Directional disagreements are always significant
    }
  } else {
    // Generic text comparison for other types
    if (checkTextConflict(fact1.value, fact2.value)) {
      conflictType = "categorical_disagreement";
      severity = "low";
    }
  }

  if (!conflictType) {
    return null;
  }

  // Build conflicting facts
  const trust1 = getSourceTrustScore(source1.source_url);
  const trust2 = getSourceTrustScore(source2.source_url);

  const conflictingFacts: ConflictingFact[] = [
    {
      fact_id: fact1.id,
      source_id: source1.id,
      source_name: source1.source_name,
      source_class: source1.source_class,
      source_trust: trust1,
      value: fact1.value,
      confidence: fact1.confidence,
      extracted_at: fact1.extracted_at,
    },
    {
      fact_id: fact2.id,
      source_id: source2.id,
      source_name: source2.source_name,
      source_class: source2.source_class,
      source_trust: trust2,
      value: fact2.value,
      confidence: fact2.confidence,
      extracted_at: fact2.extracted_at,
    },
  ];

  // Generate explanation and recommendation
  const explanation = generateConflictExplanation(
    fact1.fact_type,
    conflictType,
    conflictingFacts
  );
  const recommendation = determineRecommendation(conflictType, conflictingFacts);

  return {
    id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conflict_type: conflictType,
    severity,
    fact_type: fact1.fact_type,
    facts: conflictingFacts,
    explanation,
    recommendation,
    created_at: new Date().toISOString(),
  };
}

/**
 * Merge conflicts into a single report, combining related conflicts.
 */
export function mergeConflicts(conflicts: FactConflict[]): FactConflict[] {
  const merged: FactConflict[] = [];
  const processed = new Set<string>();

  for (const conflict of conflicts) {
    if (processed.has(conflict.id)) continue;

    // Find related conflicts (same fact type)
    const related = conflicts.filter(
      (c) =>
        c.id !== conflict.id &&
        c.fact_type === conflict.fact_type &&
        !processed.has(c.id)
    );

    if (related.length === 0) {
      merged.push(conflict);
      processed.add(conflict.id);
      continue;
    }

    // Merge all related conflicts into one
    const allFacts = new Map<string, ConflictingFact>();
    for (const f of conflict.facts) {
      allFacts.set(f.fact_id, f);
    }
    for (const r of related) {
      for (const f of r.facts) {
        allFacts.set(f.fact_id, f);
      }
      processed.add(r.id);
    }

    // Determine highest severity
    const severities: ConflictSeverity[] = [conflict.severity];
    for (const r of related) {
      severities.push(r.severity);
    }
    const highestSeverity = severities.includes("high")
      ? "high"
      : severities.includes("medium")
      ? "medium"
      : "low";

    // Create merged conflict
    const mergedFacts = Array.from(allFacts.values());
    merged.push({
      id: conflict.id,
      conflict_type: conflict.conflict_type,
      severity: highestSeverity,
      fact_type: conflict.fact_type,
      facts: mergedFacts,
      explanation: generateMergedExplanation(conflict.fact_type, mergedFacts),
      recommendation:
        mergedFacts.length > 2 ? "manual_review" : conflict.recommendation,
      created_at: conflict.created_at,
    });
    processed.add(conflict.id);
  }

  return merged;
}

// ============================================================================
// Conflict Detection Helpers
// ============================================================================

function groupFactsByType(facts: ResearchFact[]): Map<string, ResearchFact[]> {
  const grouped = new Map<string, ResearchFact[]>();

  for (const fact of facts) {
    const existing = grouped.get(fact.fact_type) ?? [];
    existing.push(fact);
    grouped.set(fact.fact_type, existing);
  }

  return grouped;
}

function checkNumericConflict(
  value1: FactValue,
  value2: FactValue
): { severity: ConflictSeverity } | null {
  const num1 = extractNumericValue(value1);
  const num2 = extractNumericValue(value2);

  if (num1 === null || num2 === null) {
    return null;
  }

  // Calculate percentage difference
  const avg = (num1 + num2) / 2;
  if (avg === 0) {
    return num1 !== num2 ? { severity: "low" } : null;
  }

  const percentDiff = Math.abs(num1 - num2) / avg;

  if (percentDiff < NUMERIC_DISAGREEMENT_THRESHOLD) {
    return null; // Within acceptable range
  }

  const severity: ConflictSeverity =
    percentDiff >= HIGH_SEVERITY_THRESHOLD ? "high" : "medium";

  return { severity };
}

function checkCategoricalConflict(value1: FactValue, value2: FactValue): boolean {
  const str1 = extractTextValue(value1)?.toLowerCase().trim();
  const str2 = extractTextValue(value2)?.toLowerCase().trim();

  if (!str1 || !str2) {
    return false;
  }

  // Different categories = conflict
  return str1 !== str2;
}

function checkDirectionalConflict(value1: FactValue, value2: FactValue): boolean {
  const str1 = extractTextValue(value1)?.toLowerCase();
  const str2 = extractTextValue(value2)?.toLowerCase();

  if (!str1 || !str2) {
    return false;
  }

  // Check for opposing directions
  const isUp1 =
    str1.includes("increasing") ||
    str1.includes("growing") ||
    str1.includes("rising") ||
    str1.includes("positive");
  const isDown1 =
    str1.includes("decreasing") ||
    str1.includes("declining") ||
    str1.includes("falling") ||
    str1.includes("negative");

  const isUp2 =
    str2.includes("increasing") ||
    str2.includes("growing") ||
    str2.includes("rising") ||
    str2.includes("positive");
  const isDown2 =
    str2.includes("decreasing") ||
    str2.includes("declining") ||
    str2.includes("falling") ||
    str2.includes("negative");

  // Conflict if one is up and one is down
  return (isUp1 && isDown2) || (isDown1 && isUp2);
}

function checkTextConflict(value1: FactValue, value2: FactValue): boolean {
  const str1 = extractTextValue(value1);
  const str2 = extractTextValue(value2);

  if (!str1 || !str2) {
    return false;
  }

  // Significant text differences (more than minor wording changes)
  const normalized1 = str1.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalized2 = str2.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Simple Jaccard similarity - conflict if < 50% overlap
  const words1 = new Set(normalized1.split(/\s+/));
  const words2 = new Set(normalized2.split(/\s+/));
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  const similarity = intersection.size / union.size;
  return similarity < 0.5;
}

function extractNumericValue(value: FactValue): number | null {
  // Cast to unknown for flexible type checking (values may come from various sources)
  const v = value as unknown;

  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>;
    if ("value" in obj && typeof obj.value === "number") {
      return obj.value;
    }
    if ("amount" in obj && typeof obj.amount === "number") {
      return obj.amount;
    }
    if ("rate" in obj && typeof obj.rate === "number") {
      return obj.rate;
    }
    if ("count" in obj && typeof obj.count === "number") {
      return obj.count;
    }
  }
  if (typeof v === "string") {
    const parsed = parseFloat(v.replace(/[^0-9.-]/g, ""));
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractTextValue(value: FactValue): string | null {
  // Cast to unknown for flexible type checking
  const v = value as unknown;

  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>;
    if ("text" in obj && typeof obj.text === "string") {
      return obj.text;
    }
    if ("description" in obj && typeof obj.description === "string") {
      return obj.description;
    }
    if ("name" in obj && typeof obj.name === "string") {
      return obj.name;
    }
  }
  return null;
}

// ============================================================================
// Explanation Generation
// ============================================================================

function generateConflictExplanation(
  factType: string,
  conflictType: ConflictType,
  facts: ConflictingFact[]
): string {
  const [fact1, fact2] = facts;

  const formatValue = (v: FactValue): string => {
    const val = v as unknown;
    if (typeof val === "number") return val.toLocaleString();
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null) {
      const obj = val as Record<string, unknown>;
      if ("value" in obj) return String(obj.value);
      if ("text" in obj) return String(obj.text);
      if ("amount" in obj) return String(obj.amount);
      return JSON.stringify(val);
    }
    return String(val);
  };

  switch (conflictType) {
    case "numeric_disagreement": {
      const num1 = extractNumericValue(fact1.value);
      const num2 = extractNumericValue(fact2.value);
      const percentDiff =
        num1 && num2 ? Math.round(Math.abs(num1 - num2) / ((num1 + num2) / 2) * 100) : 0;

      return (
        `Two sources disagree on ${factType.replace(/_/g, " ")}. ` +
        `${fact1.source_name} (${fact1.source_class}) reports ${formatValue(fact1.value)}, ` +
        `while ${fact2.source_name} (${fact2.source_class}) reports ${formatValue(fact2.value)}. ` +
        `This represents a ${percentDiff}% difference.`
      );
    }

    case "categorical_disagreement":
      return (
        `Two sources provide different ${factType.replace(/_/g, " ")} classifications. ` +
        `${fact1.source_name} categorizes it as "${formatValue(fact1.value)}", ` +
        `while ${fact2.source_name} categorizes it as "${formatValue(fact2.value)}".`
      );

    case "directional_disagreement":
      return (
        `Two sources disagree on the direction of ${factType.replace(/_/g, " ")}. ` +
        `${fact1.source_name} indicates "${formatValue(fact1.value)}", ` +
        `while ${fact2.source_name} indicates "${formatValue(fact2.value)}". ` +
        `This directional conflict requires careful review.`
      );

    case "temporal_disagreement":
      return (
        `Two sources report ${factType.replace(/_/g, " ")} for different time periods. ` +
        `${fact1.source_name}: ${formatValue(fact1.value)}, ` +
        `${fact2.source_name}: ${formatValue(fact2.value)}.`
      );

    default:
      return `Sources disagree on ${factType.replace(/_/g, " ")}.`;
  }
}

function generateMergedExplanation(
  factType: string,
  facts: ConflictingFact[]
): string {
  const sources = facts.map((f) => f.source_name).join(", ");
  return (
    `Multiple sources (${facts.length}) provide conflicting information about ${factType.replace(/_/g, " ")}. ` +
    `Sources: ${sources}. Manual review recommended to determine the most accurate value.`
  );
}

// ============================================================================
// Recommendation Logic
// ============================================================================

function determineRecommendation(
  conflictType: ConflictType,
  facts: ConflictingFact[]
): ConflictRecommendation {
  const [fact1, fact2] = facts;

  // Check trust score difference
  const trustDiff = Math.abs(fact1.source_trust - fact2.source_trust);
  if (trustDiff >= TRUST_PREFERENCE_THRESHOLD) {
    return "prefer_higher_trust";
  }

  // Check recency
  const date1 = new Date(fact1.extracted_at).getTime();
  const date2 = new Date(fact2.extracted_at).getTime();
  const daysDiff = Math.abs(date1 - date2) / (1000 * 60 * 60 * 24);

  if (daysDiff > 30) {
    return "prefer_more_recent";
  }

  // For numeric disagreements with similar trust, averaging may work
  if (conflictType === "numeric_disagreement") {
    return "average_values";
  }

  // Directional disagreements always need manual review
  if (conflictType === "directional_disagreement") {
    return "flag_for_verification";
  }

  // Default: manual review
  return "manual_review";
}

// ============================================================================
// Summary Calculation
// ============================================================================

function calculateConflictSummary(conflicts: FactConflict[]): ConflictSummary {
  const byFactType: Record<string, number> = {};

  for (const conflict of conflicts) {
    byFactType[conflict.fact_type] = (byFactType[conflict.fact_type] ?? 0) + 1;
  }

  return {
    total_conflicts: conflicts.length,
    high_severity: conflicts.filter((c) => c.severity === "high").length,
    medium_severity: conflicts.filter((c) => c.severity === "medium").length,
    low_severity: conflicts.filter((c) => c.severity === "low").length,
    by_fact_type: byFactType,
    requires_manual_review: conflicts.filter(
      (c) =>
        c.recommendation === "manual_review" ||
        c.recommendation === "flag_for_verification"
    ).length,
  };
}

// ============================================================================
// Resolution Helpers
// ============================================================================

/**
 * Apply a resolution to a conflict.
 * Returns the fact that should be preferred, or a new synthetic fact.
 */
export function applyResolution(
  conflict: FactConflict,
  resolution: ConflictResolution
): ResearchFact | null {
  if (resolution.resolution_type === "rejected") {
    return null; // No preferred fact
  }

  if (resolution.chosen_fact_id) {
    const chosen = conflict.facts.find((f) => f.fact_id === resolution.chosen_fact_id);
    if (chosen) {
      // Return a synthetic fact marked as resolved
      return {
        id: `resolved-${conflict.id}`,
        mission_id: "", // Will be set by caller
        source_id: chosen.source_id,
        fact_type: conflict.fact_type as FactType,
        value: chosen.value,
        confidence: chosen.confidence,
        extracted_by: "rule" as const,
        extraction_path: `[Resolved conflict] Chose ${chosen.source_name} over other sources. Rationale: ${resolution.rationale}`,
        extracted_at: new Date().toISOString(),
      };
    }
  }

  if (resolution.override_value) {
    // Manual override - create synthetic fact
    return {
      id: `override-${conflict.id}`,
      mission_id: "", // Will be set by caller
      source_id: "manual-override",
      fact_type: conflict.fact_type as FactType,
      value: resolution.override_value,
      confidence: 1.0, // Manual override is authoritative
      extracted_by: "rule" as const,
      extraction_path: `[Manual override] ${resolution.rationale}`,
      extracted_at: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Get the preferred fact from a conflict based on automatic recommendation.
 */
export function getPreferredFact(conflict: FactConflict): ConflictingFact | null {
  if (conflict.recommendation === "prefer_higher_trust") {
    return conflict.facts.reduce((a, b) =>
      a.source_trust > b.source_trust ? a : b
    );
  }

  if (conflict.recommendation === "prefer_more_recent") {
    return conflict.facts.reduce((a, b) =>
      new Date(a.extracted_at) > new Date(b.extracted_at) ? a : b
    );
  }

  // For manual review or other cases, return highest confidence
  if (conflict.recommendation === "average_values") {
    // For averaging, return the one with higher confidence
    return conflict.facts.reduce((a, b) =>
      a.confidence > b.confidence ? a : b
    );
  }

  return null;
}
