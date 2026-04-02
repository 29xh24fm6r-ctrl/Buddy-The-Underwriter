/* ------------------------------------------------------------------ */
/*  Trust & Confidence Model — pure computation, no DB, no IO         */
/* ------------------------------------------------------------------ */

export type SupportType =
  | "observed"
  | "derived"
  | "inferred"
  | "weakly_supported"
  | "stale"
  | "disputed";

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";

export type FreshnessStatus = "fresh" | "aging" | "stale" | "expired";

export type TrustAssessment = {
  supportType: SupportType;
  confidenceLevel: ConfidenceLevel;
  freshness: FreshnessStatus;
  contradictionStatus: "none" | "minor" | "significant" | "unresolved";
  evidenceDensity: "rich" | "adequate" | "sparse" | "none";
  decisionSafe: boolean;
  summary: string;
};

export type ConclusionInput = {
  factCount: number;
  sourceCount: number;
  sourceClasses: string[];
  highestConfidence: number;
  lowestConfidence: number;
  hasContradictions: boolean;
  contradictionSeverity?: number;
  ageHours: number;
  isDirectObservation: boolean;
};

/* ------------------------------------------------------------------ */

function deriveFreshness(ageHours: number): FreshnessStatus {
  if (ageHours <= 24) return "fresh";
  if (ageHours <= 168) return "aging";
  if (ageHours <= 720) return "stale";
  return "expired";
}

function deriveContradictionStatus(
  hasContradictions: boolean,
  severity?: number,
): "none" | "minor" | "significant" | "unresolved" {
  if (!hasContradictions) return "none";
  if (severity === undefined) return "minor";
  if (severity >= 0.8) return "unresolved";
  if (severity >= 0.5) return "significant";
  return "minor";
}

function deriveEvidenceDensity(
  factCount: number,
  sourceCount: number,
  sourceClasses: string[],
): "rich" | "adequate" | "sparse" | "none" {
  const score =
    Math.min(factCount * 10, 25) +
    Math.min(sourceCount * 8, 25) +
    Math.min(sourceClasses.length * 10, 25);
  if (score >= 75) return "rich";
  if (score >= 50) return "adequate";
  if (score >= 25) return "sparse";
  return "none";
}

export function assessConclusion(input: ConclusionInput): TrustAssessment {
  const {
    factCount,
    sourceCount,
    sourceClasses,
    highestConfidence,
    lowestConfidence: _lowestConfidence,
    hasContradictions,
    contradictionSeverity,
    ageHours,
    isDirectObservation,
  } = input;

  const freshness = deriveFreshness(ageHours);
  const contradictionStatus = deriveContradictionStatus(
    hasContradictions,
    contradictionSeverity,
  );
  const evidenceDensity = deriveEvidenceDensity(
    factCount,
    sourceCount,
    sourceClasses,
  );

  let confidenceLevel: ConfidenceLevel;
  let supportType: SupportType;

  // Staleness overrides
  if (freshness === "stale" || freshness === "expired") {
    supportType = "stale";
    confidenceLevel = freshness === "expired" ? "insufficient" : "low";
  }
  // Contradiction overrides
  else if (
    contradictionStatus === "significant" ||
    contradictionStatus === "unresolved"
  ) {
    supportType = "disputed";
    confidenceLevel =
      contradictionStatus === "unresolved" ? "insufficient" : "low";
  }
  // High confidence: observed
  else if (
    factCount >= 3 &&
    sourceClasses.length >= 2 &&
    highestConfidence > 0.8 &&
    ageHours < 24
  ) {
    supportType = isDirectObservation ? "observed" : "derived";
    confidenceLevel = "high";
  }
  // Medium confidence: derived
  else if (factCount >= 1 && highestConfidence > 0.6) {
    supportType = isDirectObservation ? "observed" : "derived";
    confidenceLevel = "medium";
  }
  // Low confidence: weakly supported
  else if (highestConfidence < 0.4 || sourceCount < 1) {
    supportType = "weakly_supported";
    confidenceLevel = "low";
  }
  // Inferred — remaining cases
  else {
    supportType = "inferred";
    confidenceLevel = "low";
  }

  const decisionSafe =
    (confidenceLevel === "high" || confidenceLevel === "medium") &&
    (freshness === "fresh" || freshness === "aging") &&
    (contradictionStatus === "none" || contradictionStatus === "minor");

  const summary = buildSummary(
    supportType,
    confidenceLevel,
    freshness,
    contradictionStatus,
    decisionSafe,
  );

  return {
    supportType,
    confidenceLevel,
    freshness,
    contradictionStatus,
    evidenceDensity,
    decisionSafe,
    summary,
  };
}

function buildSummary(
  supportType: SupportType,
  confidenceLevel: ConfidenceLevel,
  freshness: FreshnessStatus,
  contradictionStatus: string,
  decisionSafe: boolean,
): string {
  const parts: string[] = [];
  parts.push(`${confidenceLevel} confidence`);
  parts.push(`${supportType} support`);
  if (freshness !== "fresh") parts.push(`data is ${freshness}`);
  if (contradictionStatus !== "none")
    parts.push(`contradictions: ${contradictionStatus}`);
  if (!decisionSafe) parts.push("not decision-safe");
  return parts.join("; ");
}
