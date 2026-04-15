/**
 * YOY Anomaly Detector
 *
 * Compares year-over-year values for extracted P&L line items and emits
 * FINANCIAL_ANOMALY flags when variance exceeds configurable thresholds.
 *
 * Used by the spread engine after income statement extraction to surface
 * material changes that require LO review before underwriting proceeds.
 *
 * Design:
 *   - Pure function — no DB, no server imports
 *   - Called from enqueueSpreadRecompute.ts after facts are written
 *   - Returns structured anomaly records; caller decides how to persist them
 *
 * Example anomaly this catches:
 *   Ellmann & Ellmann 2024→2025: Rent $74,455 → $158,900 (+113%)
 *   This is material (paying rent after acquiring the building?) and must
 *   be flagged for the LO to explain in the write-up.
 */

export type AnomalySeverity = "INFO" | "WARNING" | "CRITICAL";

export interface YoyAnomaly {
  /** Line item / fact key */
  factKey: string;
  /** Human-readable label */
  label: string;
  /** Prior period value */
  priorValue: number;
  /** Current period value */
  currentValue: number;
  /** Absolute change */
  delta: number;
  /** Percentage change (positive = increase) */
  pctChange: number;
  /** Severity based on threshold config */
  severity: AnomalySeverity;
  /** Suggested explanation prompt for the LO */
  reviewPrompt: string;
}

export interface YoyFact {
  factKey: string;
  label: string;
  /** Year (e.g. 2024) */
  year: number;
  value: number;
}

interface AnomalyThreshold {
  /** Minimum percent change (absolute value) to trigger */
  pctThreshold: number;
  /** Minimum absolute dollar change to trigger (avoids noise on small amounts) */
  minAbsDelta: number;
  severity: AnomalySeverity;
}

// Default thresholds — tuned for commercial lending P&L review
const DEFAULT_THRESHOLDS: AnomalyThreshold[] = [
  { pctThreshold: 100, minAbsDelta: 10000, severity: "CRITICAL" }, // doubled or more
  { pctThreshold: 50,  minAbsDelta: 5000,  severity: "WARNING"  }, // 50%+ change
  { pctThreshold: 25,  minAbsDelta: 2500,  severity: "INFO"     }, // 25%+ change
];

/**
 * Generate a human-readable LO review prompt for a given anomaly.
 */
function buildReviewPrompt(anomaly: Omit<YoyAnomaly, "reviewPrompt">): string {
  const dir = anomaly.delta > 0 ? "increased" : "decreased";
  const pct = Math.abs(anomaly.pctChange).toFixed(0);
  const prior = anomaly.priorValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const curr = anomaly.currentValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  // Special-case prompts for known high-signal line items
  const lk = anomaly.factKey.toUpperCase();
  if (lk.includes("RENT")) {
    return `Rent expense ${dir} ${pct}% (${prior} → ${curr}). Verify: Was the property purchased mid-year? Is rent being paid to a related entity? Is this a NNN cost shift?`;
  }
  if (lk.includes("DEPRECIATION")) {
    return `Depreciation ${dir} ${pct}% (${prior} → ${curr}). Verify: Was new equipment or property placed in service? Confirm Section 179 or bonus depreciation elections.`;
  }
  if (lk.includes("OFFICER") || lk.includes("COMPENSATION")) {
    return `Officer compensation ${dir} ${pct}% (${prior} → ${curr}). Confirm compensation is arms-length and consistent with industry norms.`;
  }
  if (lk.includes("REVENUE") || lk.includes("SALES") || lk.includes("GROSS_RECEIPTS")) {
    return `Revenue ${dir} ${pct}% (${prior} → ${curr}). Verify revenue concentration, new/lost clients, or one-time items.`;
  }
  if (lk.includes("EMPLOYEE") || lk.includes("PAYROLL") || lk.includes("BENEFIT")) {
    return `${anomaly.label} ${dir} ${pct}% (${prior} → ${curr}). Confirm headcount change, new benefit plan, or one-time accrual.`;
  }

  return `${anomaly.label} ${dir} ${pct}% (${prior} → ${curr}). Confirm whether this change is recurring or one-time.`;
}

/**
 * Detect year-over-year anomalies across a set of financial facts.
 *
 * @param facts   — Array of { factKey, label, year, value } from deal_financial_facts
 * @param options — Optional threshold overrides and year pair to compare
 * @returns       — Array of YoyAnomaly records, sorted by severity then pctChange desc
 */
export function detectYoyAnomalies(
  facts: YoyFact[],
  options?: {
    thresholds?: AnomalyThreshold[];
    /** If specified, only compare these two years. Otherwise compares most recent pair. */
    compareYears?: [number, number];
  },
): YoyAnomaly[] {
  const thresholds = options?.thresholds ?? DEFAULT_THRESHOLDS;
  const anomalies: YoyAnomaly[] = [];

  // Group facts by factKey → year → value
  const byKey: Map<string, Map<number, { label: string; value: number }>> = new Map();
  for (const f of facts) {
    if (!byKey.has(f.factKey)) byKey.set(f.factKey, new Map());
    byKey.get(f.factKey)!.set(f.year, { label: f.label, value: f.value });
  }

  // Determine which year pair to compare
  const allYears = Array.from(new Set(facts.map((f) => f.year))).sort();
  let priorYear: number, currentYear: number;
  if (options?.compareYears) {
    [priorYear, currentYear] = options.compareYears;
  } else if (allYears.length >= 2) {
    priorYear = allYears[allYears.length - 2];
    currentYear = allYears[allYears.length - 1];
  } else {
    return []; // Need at least 2 years
  }

  for (const [factKey, yearMap] of byKey.entries()) {
    const priorEntry = yearMap.get(priorYear);
    const currentEntry = yearMap.get(currentYear);
    if (!priorEntry || !currentEntry) continue;

    const { value: priorValue, label } = priorEntry;
    const { value: currentValue } = currentEntry;

    // Skip zero-to-nonzero (appearance/disappearance handled separately)
    if (priorValue === 0) continue;

    const delta = currentValue - priorValue;
    const pctChange = (delta / Math.abs(priorValue)) * 100;
    const absPctChange = Math.abs(pctChange);
    const absDelta = Math.abs(delta);

    // Find matching threshold (most severe first)
    const matchedThreshold = thresholds
      .slice()
      .sort((a, b) => b.pctThreshold - a.pctThreshold)
      .find(
        (t) => absPctChange >= t.pctThreshold && absDelta >= t.minAbsDelta,
      );

    if (matchedThreshold) {
      const base = {
        factKey,
        label: label || factKey,
        priorValue,
        currentValue,
        delta,
        pctChange,
        severity: matchedThreshold.severity,
      };
      anomalies.push({ ...base, reviewPrompt: buildReviewPrompt(base) });
    }
  }

  // Sort: CRITICAL first, then WARNING, then INFO; within tier by abs pct desc
  const severityOrder: Record<AnomalySeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return anomalies.sort((a, b) => {
    const sord = severityOrder[a.severity] - severityOrder[b.severity];
    if (sord !== 0) return sord;
    return Math.abs(b.pctChange) - Math.abs(a.pctChange);
  });
}

/**
 * Format anomalies as a structured LO review summary string.
 * Used in the deal intelligence narrative and copilot prompts.
 */
export function formatAnomalySummary(anomalies: YoyAnomaly[], priorYear: number, currentYear: number): string {
  if (anomalies.length === 0) return "";
  const lines = [
    `⚠️  YOY Financial Anomalies Detected (${priorYear} → ${currentYear}):`,
    "",
  ];
  for (const a of anomalies) {
    const badge = a.severity === "CRITICAL" ? "🔴" : a.severity === "WARNING" ? "🟡" : "🔵";
    lines.push(`${badge} [${a.severity}] ${a.label}: ${a.pctChange > 0 ? "+" : ""}${a.pctChange.toFixed(0)}%`);
    lines.push(`   → ${a.reviewPrompt}`);
    lines.push("");
  }
  return lines.join("\n");
}
