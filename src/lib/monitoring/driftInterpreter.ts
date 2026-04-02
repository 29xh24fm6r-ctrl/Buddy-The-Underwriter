/* ------------------------------------------------------------------ */
/*  Drift Interpreter — pure computation, no DB, no IO                */
/* ------------------------------------------------------------------ */

export type DriftInterpretation = {
  direction: "improving" | "stable" | "deteriorating";
  /** Absolute percentage change from baseline */
  magnitude: number;
  severity: "info" | "warning" | "alert" | "critical";
  narrative: string;
};

/**
 * Interprets monitoring drift between a current value and a baseline.
 *
 * @param current      The current metric value
 * @param baseline     The baseline (prior period or target) value
 * @param thresholdPct Percentage threshold for considering a change meaningful
 *                     (e.g. 5 means ±5%)
 */
export function interpretDrift(
  current: number,
  baseline: number,
  thresholdPct: number,
): DriftInterpretation {
  if (baseline === 0) {
    // Cannot compute drift from zero baseline
    return {
      direction: "stable",
      magnitude: 0,
      severity: "info",
      narrative:
        "Baseline value is zero — unable to compute a meaningful drift percentage.",
    };
  }

  const changePct = ((current - baseline) / Math.abs(baseline)) * 100;
  const magnitude = Math.abs(changePct);

  // Direction: positive change = improving for most metrics
  let direction: DriftInterpretation["direction"];
  if (magnitude <= thresholdPct) {
    direction = "stable";
  } else if (changePct > 0) {
    direction = "improving";
  } else {
    direction = "deteriorating";
  }

  // Severity
  let severity: DriftInterpretation["severity"];
  if (magnitude <= thresholdPct) {
    severity = "info";
  } else if (magnitude <= thresholdPct * 2) {
    severity = direction === "deteriorating" ? "warning" : "info";
  } else if (magnitude <= thresholdPct * 3) {
    severity = direction === "deteriorating" ? "alert" : "warning";
  } else {
    // magnitude > 2x threshold
    severity = direction === "deteriorating" ? "critical" : "warning";
  }

  // Narrative
  const dirLabel =
    direction === "stable"
      ? "remained stable"
      : direction === "improving"
        ? "improved"
        : "deteriorated";

  const narrative =
    direction === "stable"
      ? `The metric ${dirLabel} at ${current.toLocaleString("en-US", { maximumFractionDigits: 2 })} (within ±${thresholdPct}% of the ${baseline.toLocaleString("en-US", { maximumFractionDigits: 2 })} baseline).`
      : `The metric ${dirLabel} by ${magnitude.toFixed(1)}% from ${baseline.toLocaleString("en-US", { maximumFractionDigits: 2 })} to ${current.toLocaleString("en-US", { maximumFractionDigits: 2 })}.`;

  return { direction, magnitude, severity, narrative };
}
