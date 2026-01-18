import type { OutcomeSnapshot, OutcomeResult } from "@/buddy/outcomes/types";
import type { ReadinessBreakdown } from "@/buddy/readiness/calcReadiness";

export function calcOutcome(
  before: OutcomeSnapshot | null,
  after: ReadinessBreakdown | null
): OutcomeResult | null {
  if (!before || !after) return null;

  const deltaReadiness =
    typeof before.readinessPct === "number"
      ? after.readinessPct - before.readinessPct
      : undefined;

  const deltaReceived =
    typeof before.received === "number" && typeof after.received === "number"
      ? after.received - before.received
      : undefined;

  const deltaMissing =
    typeof before.missing === "number" && typeof after.missing === "number"
      ? after.missing - before.missing
      : undefined;

  const parts: string[] = [];
  if (typeof deltaReadiness === "number" && deltaReadiness !== 0) {
    parts.push(`readiness ${deltaReadiness > 0 ? "up" : "down"} ${Math.abs(deltaReadiness)}%`);
  }
  if (typeof deltaReceived === "number" && deltaReceived > 0) {
    parts.push(`+${deltaReceived} document${deltaReceived === 1 ? "" : "s"} received`);
  }
  if (typeof deltaMissing === "number" && deltaMissing < 0) {
    parts.push(`${Math.abs(deltaMissing)} blocker${Math.abs(deltaMissing) === 1 ? "" : "s"} cleared`);
  }

  if (!parts.length) return null;

  return {
    deltaReadiness,
    deltaReceived,
    deltaMissing,
    message: parts.join(" · "),
  };
}
