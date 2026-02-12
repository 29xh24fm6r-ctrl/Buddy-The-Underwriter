/**
 * Model Engine V2 — Parity Report Formatter
 *
 * Formats a ParityComparison into a human-readable markdown summary.
 * Read-only. No side effects.
 */

import type { ParityComparison, LineDiff, HeadlineDiff } from "./types";

/**
 * Format a parity comparison result as a markdown report.
 */
export function formatParityReport(comparison: ParityComparison): string {
  const lines: string[] = [];

  lines.push(`# Parity Report: ${comparison.dealId}`);
  lines.push("");
  lines.push(`**Verdict: ${comparison.passFail}**`);
  lines.push("");

  // Period alignment
  lines.push("## Period Alignment");
  lines.push("");
  lines.push("| Period End | V1 Label | V2 Period | Status |");
  lines.push("|-----------|----------|-----------|--------|");
  for (const p of comparison.periods) {
    lines.push(
      `| ${p.periodEnd} | ${p.v1Label ?? "—"} | ${p.v2PeriodEnd ?? "—"} | ${p.source} |`,
    );
  }
  lines.push("");

  // Headline metrics
  lines.push("## Headline Metrics");
  lines.push("");
  lines.push("| Metric | Period | V1 | V2 | Abs Diff | % Diff | Pass |");
  lines.push("|--------|--------|----|----|----------|--------|------|");
  for (const h of comparison.headline) {
    lines.push(
      `| ${h.metric} | ${h.periodEnd} | ${fmtVal(h.v1Value)} | ${fmtVal(h.v2Value)} | ${fmtVal(h.absDiff)} | ${fmtPct(h.pctDiff)} | ${h.withinTolerance ? "PASS" : "FAIL"} |`,
    );
  }
  lines.push("");

  // Line diffs (mismatches only)
  const mismatches = comparison.diffs.filter((d) => d.status === "mismatch");
  if (mismatches.length > 0) {
    lines.push("## Line Item Mismatches");
    lines.push("");
    lines.push("| Section | Key | Period | V1 | V2 | Abs Diff | % Diff |");
    lines.push("|---------|-----|--------|----|----|----------|--------|");
    for (const d of mismatches) {
      lines.push(
        `| ${d.section} | ${d.label} | ${d.periodEnd} | ${fmtVal(d.v1Value)} | ${fmtVal(d.v2Value)} | ${fmtVal(d.absDiff)} | ${fmtPct(d.pctDiff)} |`,
      );
    }
    lines.push("");
  }

  // V1-only and V2-only lines
  const v1Only = comparison.diffs.filter((d) => d.status === "v1_only");
  const v2Only = comparison.diffs.filter((d) => d.status === "v2_only");

  if (v1Only.length > 0) {
    lines.push("## V1-Only Lines (missing in V2)");
    lines.push("");
    for (const d of v1Only) {
      lines.push(`- ${d.label} (${d.key}): ${fmtVal(d.v1Value)} @ ${d.periodEnd}`);
    }
    lines.push("");
  }

  if (v2Only.length > 0) {
    lines.push("## V2-Only Lines (missing in V1)");
    lines.push("");
    for (const d of v2Only) {
      lines.push(`- ${d.label} (${d.key}): ${fmtVal(d.v2Value)} @ ${d.periodEnd}`);
    }
    lines.push("");
  }

  // Flags
  if (comparison.flags.length > 0) {
    lines.push("## Flags");
    lines.push("");
    for (const f of comparison.flags) {
      const icon = f.severity === "error" ? "[ERROR]" : "[WARN]";
      lines.push(`- ${icon} **${f.type}**: ${f.detail}`);
    }
    lines.push("");
  }

  // Thresholds
  lines.push("## Thresholds Used");
  lines.push("");
  lines.push(`- Line item tolerance: $${comparison.thresholdsUsed.lineItemTolerance}`);
  lines.push(`- Headline abs tolerance: $${comparison.thresholdsUsed.headlineAbsTolerance}`);
  lines.push(`- Headline pct tolerance: ${(comparison.thresholdsUsed.headlinePctTolerance * 100).toFixed(2)}%`);
  lines.push(`- Missing period fails: ${comparison.thresholdsUsed.missingPeriodFails}`);

  // Summary stats
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  const matchCount = comparison.diffs.filter((d) => d.status === "match").length;
  const mismatchCount = mismatches.length;
  const totalDiffs = comparison.diffs.length;
  lines.push(`- Total comparisons: ${totalDiffs}`);
  lines.push(`- Matches: ${matchCount}`);
  lines.push(`- Mismatches: ${mismatchCount}`);
  lines.push(`- V1-only: ${v1Only.length}`);
  lines.push(`- V2-only: ${v2Only.length}`);
  lines.push(`- Flags: ${comparison.flags.length} (${comparison.flags.filter((f) => f.severity === "error").length} errors)`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtVal(v: number | null): string {
  if (v === null) return "—";
  if (!Number.isFinite(v)) return "Inf";
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(4);
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  if (!Number.isFinite(v)) return "Inf";
  return (v * 100).toFixed(2) + "%";
}
