/* ------------------------------------------------------------------ */
/*  Trust Badge Builder — pure computation, no DB, no IO              */
/* ------------------------------------------------------------------ */

import type { TrustAssessment } from "./confidenceModel";

export type TrustBadge = {
  label: string;
  color: "green" | "blue" | "yellow" | "orange" | "red" | "gray";
  icon: "shield" | "check" | "info" | "alert" | "warning" | "question";
  tooltip: string;
  bankerLabel: string;
  borrowerLabel: string;
};

export function buildTrustBadge(assessment: TrustAssessment): TrustBadge {
  const { supportType, confidenceLevel, freshness, contradictionStatus } =
    assessment;

  // Disputed takes priority
  if (contradictionStatus === "significant" || contradictionStatus === "unresolved") {
    return {
      label: "Under Review",
      color: "gray",
      icon: "question",
      tooltip:
        "Conflicting data sources — this conclusion is under review and should not be relied upon.",
      bankerLabel: "Under Review",
      borrowerLabel: "Under Review",
    };
  }

  // Stale / expired
  if (freshness === "stale" || freshness === "expired" || supportType === "stale") {
    return {
      label: "Stale Data",
      color: "red",
      icon: "warning",
      tooltip:
        "This data is outdated. Refresh the underlying sources before relying on this conclusion.",
      bankerLabel: "Stale Data",
      borrowerLabel: "Outdated",
    };
  }

  // Weakly supported
  if (supportType === "weakly_supported" || confidenceLevel === "insufficient") {
    return {
      label: "Incomplete",
      color: "orange",
      icon: "alert",
      tooltip:
        "Insufficient evidence to support this conclusion. Additional data sources are needed.",
      bankerLabel: "Incomplete",
      borrowerLabel: "Needs More Info",
    };
  }

  // High confidence, observed/derived, fresh
  if (confidenceLevel === "high" && (freshness === "fresh" || freshness === "aging")) {
    return {
      label: "Highly Dependable",
      color: "green",
      icon: "shield",
      tooltip:
        "Supported by multiple corroborating sources with high confidence. Safe for decision-making.",
      bankerLabel: "Highly Dependable",
      borrowerLabel: "Solid Signal",
    };
  }

  // Medium confidence, derived, fresh/aging
  if (
    confidenceLevel === "medium" &&
    (freshness === "fresh" || freshness === "aging")
  ) {
    return {
      label: "Directionally Useful",
      color: "blue",
      icon: "check",
      tooltip:
        "Supported by available data with reasonable confidence. Useful for directional guidance.",
      bankerLabel: "Directionally Useful",
      borrowerLabel: "Good Indicator",
    };
  }

  // Low confidence / inferred
  if (confidenceLevel === "low" || supportType === "inferred") {
    return {
      label: "Use With Caution",
      color: "yellow",
      icon: "info",
      tooltip:
        "Based on limited or inferred data. Use as an early signal but verify before acting.",
      bankerLabel: "Use With Caution",
      borrowerLabel: "Early Signal",
    };
  }

  // Fallback
  return {
    label: "Use With Caution",
    color: "yellow",
    icon: "info",
    tooltip: "Limited supporting evidence. Treat as directional only.",
    bankerLabel: "Use With Caution",
    borrowerLabel: "Early Signal",
  };
}
