import type { CorrectionEvent, CorrectionPattern } from "./types";

/**
 * Analyze correction events to identify systematic extraction error patterns.
 * Pure function — no DB, no side effects.
 */
export function analyzePatterns(
  corrections: CorrectionEvent[],
  totalExtractionsByKeyAndType: Record<string, number>
): CorrectionPattern[] {
  if (corrections.length === 0) return [];

  // Group corrections by factKey + documentType
  const groups = new Map<string, CorrectionEvent[]>();
  for (const c of corrections) {
    const key = `${c.factKey}::${c.documentType}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(c);
    } else {
      groups.set(key, [c]);
    }
  }

  const patterns: CorrectionPattern[] = [];
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  for (const [compositeKey, events] of groups) {
    const [factKey, documentType] = compositeKey.split("::");
    const totalExtractions = totalExtractionsByKeyAndType[compositeKey] ?? 0;
    const correctionCount = events.length;
    const errorRate =
      totalExtractions > 0 ? correctionCount / totalExtractions : 0;

    // Compute average delta
    const deltas: number[] = [];
    for (const e of events) {
      if (e.originalValue !== null && e.correctedValue !== null) {
        deltas.push(Math.abs(e.correctedValue - e.originalValue));
      }
    }
    const avgDelta =
      deltas.length > 0
        ? deltas.reduce((a, b) => a + b, 0) / deltas.length
        : null;

    // Compute trend by comparing last-30-days rate to prior-30-days rate
    const recentEvents = events.filter(
      (e) => now - new Date(e.correctedAt).getTime() < THIRTY_DAYS_MS
    );
    const priorEvents = events.filter((e) => {
      const age = now - new Date(e.correctedAt).getTime();
      return age >= THIRTY_DAYS_MS && age < 2 * THIRTY_DAYS_MS;
    });

    let trend: CorrectionPattern["trend"] = "STABLE";
    if (recentEvents.length > 0 && priorEvents.length > 0) {
      const recentRate = recentEvents.length;
      const priorRate = priorEvents.length;
      if (recentRate < priorRate * 0.8) {
        trend = "IMPROVING";
      } else if (recentRate > priorRate * 1.2) {
        trend = "DEGRADING";
      }
    }

    // Find most recent correction
    const sortedDates = events
      .map((e) => e.correctedAt)
      .sort()
      .reverse();
    const lastSeen = sortedDates[0];

    patterns.push({
      factKey,
      documentType,
      correctionCount,
      errorRate,
      avgDelta,
      trend,
      lastSeen,
      flaggedForReview: errorRate > 0.05,
    });
  }

  return patterns;
}
