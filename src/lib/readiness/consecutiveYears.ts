/**
 * Consecutive Years Evaluator
 *
 * Pure function that determines whether a set of tax years satisfies
 * a "N consecutive years" requirement with a recency check.
 *
 * Used by the checklist engine for IRS_BUSINESS_3Y / IRS_PERSONAL_3Y items.
 */

export type ConsecutiveYearsResult = {
  ok: boolean;
  /** The qualifying consecutive run, if found. start <= end. */
  run?: { start: number; end: number; years: number[] };
  /** Human-readable reason when ok=false. */
  reason?: string;
};

/**
 * Evaluate whether `years` contains a consecutive run of length >= `requiredCount`
 * whose most recent year is >= `minMostRecentYear`.
 *
 * @param years        - Tax years present on received documents (may contain duplicates)
 * @param requiredCount - Minimum consecutive run length (e.g., 3)
 * @param minMostRecentYear - The earliest acceptable "most recent year" in a qualifying run
 */
export function evaluateConsecutiveYears(
  years: number[],
  requiredCount: number,
  minMostRecentYear: number,
): ConsecutiveYearsResult {
  // Deduplicate and sort ascending
  const unique = [...new Set(years.filter((y) => Number.isFinite(y)))].sort(
    (a, b) => a - b,
  );

  if (unique.length === 0) {
    return {
      ok: false,
      reason: `Need ${requiredCount} more year(s)`,
    };
  }

  if (unique.length < requiredCount) {
    const needed = requiredCount - unique.length;
    return {
      ok: false,
      reason: `Need ${needed} more year${needed === 1 ? "" : "s"}`,
    };
  }

  // Find all maximal consecutive runs
  const runs: { start: number; end: number; years: number[] }[] = [];
  let runStart = unique[0];
  let runYears = [unique[0]];

  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === unique[i - 1] + 1) {
      runYears.push(unique[i]);
    } else {
      runs.push({ start: runStart, end: unique[i - 1], years: [...runYears] });
      runStart = unique[i];
      runYears = [unique[i]];
    }
  }
  runs.push({
    start: runStart,
    end: unique[unique.length - 1],
    years: [...runYears],
  });

  // Keep runs with length >= requiredCount
  const qualifying = runs.filter((r) => r.years.length >= requiredCount);

  if (qualifying.length === 0) {
    // Find the first gap to give a helpful message
    for (let i = 1; i < unique.length; i++) {
      if (unique[i] !== unique[i - 1] + 1) {
        return {
          ok: false,
          reason: `Gap between ${unique[i - 1]} and ${unique[i]} — years must be consecutive`,
        };
      }
    }
    // Shouldn't reach here given length >= requiredCount, but guard anyway
    return { ok: false, reason: "Years are not consecutive" };
  }

  // Pick the run with the greatest "end" (most recent)
  const best = qualifying.reduce((a, b) => (b.end >= a.end ? b : a));

  // For runs longer than requiredCount, take the most recent N years
  if (best.years.length > requiredCount) {
    const trimmed = best.years.slice(best.years.length - requiredCount);
    return evaluateRecency(
      { start: trimmed[0], end: trimmed[trimmed.length - 1], years: trimmed },
      minMostRecentYear,
    );
  }

  return evaluateRecency(best, minMostRecentYear);
}

function evaluateRecency(
  run: { start: number; end: number; years: number[] },
  minMostRecentYear: number,
): ConsecutiveYearsResult {
  if (run.end >= minMostRecentYear) {
    return { ok: true, run };
  }
  return {
    ok: false,
    run,
    reason: `Most recent year on file is ${run.end}; need ${minMostRecentYear}+`,
  };
}

/**
 * Format a year range for display: "2022–2024"
 */
export function formatYearRange(start: number, end: number): string {
  if (start === end) return String(start);
  return `${start}\u2013${end}`;
}
