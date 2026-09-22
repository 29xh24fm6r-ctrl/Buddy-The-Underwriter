/** One evidence threshold for preflight and publication; narratives cannot fill gaps. */
export function feasibilityCompletenessBlocker(value: unknown, missingEvidence: string[]): string | null {
  const raw = Number(value ?? 0);
  const fraction = raw > 1 ? raw / 100 : raw;
  if (Number.isFinite(fraction) && fraction >= 0.7 && fraction <= 1) return null;
  const pct = Number.isFinite(fraction) ? `${(fraction * 100).toFixed(0)}%` : "unknown";
  const gaps = missingEvidence.length
    ? `missing evidence: ${[...missingEvidence].sort().join(", ")}`
    : "the study recorded no per-metric gaps";
  return `feasibility_data_completeness_below_70_percent — at ${pct}; ${gaps}`;
}
