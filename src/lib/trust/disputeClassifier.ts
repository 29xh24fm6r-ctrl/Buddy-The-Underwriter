/* ------------------------------------------------------------------ */
/*  Dispute Classifier — pure computation, no DB, no IO               */
/* ------------------------------------------------------------------ */

export type DisputeInput = {
  claimA: string;
  claimB: string;
  confidenceA: number;
  confidenceB: number;
  sourceClassA: string;
  sourceClassB: string;
};

export type DisputeDetail = {
  description: string;
  severity: "minor" | "significant";
  resolution?: string;
};

export type DisputeClassification = {
  status: "none" | "minor" | "significant" | "unresolved";
  disputes: DisputeDetail[];
  recommendation: string;
};

export function classifyDispute(
  inputs: DisputeInput[],
): DisputeClassification {
  if (inputs.length === 0) {
    return {
      status: "none",
      disputes: [],
      recommendation: "No contradictions detected.",
    };
  }

  const disputes: DisputeDetail[] = [];

  for (const input of inputs) {
    const {
      claimA,
      claimB,
      confidenceA,
      confidenceB,
      sourceClassA,
      sourceClassB,
    } = input;

    const confidenceDiff = Math.abs(confidenceA - confidenceB);
    const sameSourceClass = sourceClassA === sourceClassB;

    if (sameSourceClass && confidenceDiff > 0.5) {
      // Same source class, large confidence gap = significant
      disputes.push({
        description: `"${claimA}" vs "${claimB}" — same source class (${sourceClassA}) with confidence gap of ${(confidenceDiff * 100).toFixed(0)}%`,
        severity: "significant",
        resolution: `Prefer the claim with higher confidence (${confidenceA >= confidenceB ? claimA : claimB})`,
      });
    } else if (!sameSourceClass) {
      const bothHigh = confidenceA >= 0.7 && confidenceB >= 0.7;
      if (bothHigh) {
        // Both high confidence, opposing claims from different sources = unresolved-level
        disputes.push({
          description: `"${claimA}" (${sourceClassA}, ${(confidenceA * 100).toFixed(0)}%) vs "${claimB}" (${sourceClassB}, ${(confidenceB * 100).toFixed(0)}%) — both high confidence from different sources`,
          severity: "significant",
        });
      } else {
        // Different source classes, one lower trust = minor
        const lowerSource =
          confidenceA < confidenceB ? sourceClassA : sourceClassB;
        disputes.push({
          description: `"${claimA}" (${sourceClassA}) vs "${claimB}" (${sourceClassB}) — lower-trust source: ${lowerSource}`,
          severity: "minor",
          resolution: `Prefer the higher-confidence source (${confidenceA >= confidenceB ? sourceClassA : sourceClassB})`,
        });
      }
    } else {
      // Same source class, small confidence gap
      disputes.push({
        description: `"${claimA}" vs "${claimB}" — minor discrepancy within ${sourceClassA}`,
        severity: "minor",
        resolution: "Review source data for data-entry errors.",
      });
    }
  }

  // Determine overall status
  const hasSignificant = disputes.some((d) => d.severity === "significant");
  const allSignificant = disputes.every((d) => d.severity === "significant");

  // Check for unresolved: multiple significant disputes with no resolution
  const unresolvedCount = disputes.filter(
    (d) => d.severity === "significant" && !d.resolution,
  ).length;

  let status: DisputeClassification["status"];
  let recommendation: string;

  if (unresolvedCount > 0) {
    status = "unresolved";
    recommendation =
      "Multiple high-confidence sources conflict without a clear resolution. Manual review is required before using these conclusions for decisions.";
  } else if (allSignificant) {
    status = "significant";
    recommendation =
      "Significant contradictions detected. Verify source data and consider requesting updated documents before proceeding.";
  } else if (hasSignificant) {
    status = "significant";
    recommendation =
      "Some significant contradictions exist alongside minor ones. Address significant items before relying on these conclusions.";
  } else {
    status = "minor";
    recommendation =
      "Minor discrepancies detected. These are common and typically resolvable with source verification.";
  }

  return { status, disputes, recommendation };
}
