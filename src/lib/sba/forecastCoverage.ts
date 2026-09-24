/** Evaluate the saved three-year forecast without recomputing any financials.
 * Missing or nonfinite values remain unknown; a strong first year cannot
 * establish coverage for the entire horizon. */
export function forecastCoverage(values: readonly (number | null | undefined)[], threshold: number) {
  const years = Array.from({ length: 3 }, (_, index) => {
    const value = values[index];
    return { year: index + 1, value: typeof value === "number" && Number.isFinite(value) ? value : null };
  });
  const known = years.filter((entry): entry is { year: number; value: number } => entry.value !== null);
  const missing = years.filter(entry => entry.value === null).map(entry => `Year ${entry.year}`);
  const describe = (entries: typeof known) => entries.map(entry => `Year ${entry.year} ${entry.value.toFixed(2)}x`).join(", ");
  const belowThreshold = known.filter(entry => entry.value < threshold);
  const belowDebtService = known.filter(entry => entry.value < 1);
  return {
    complete: missing.length === 0,
    missing,
    minimum: known.length ? Math.min(...known.map(entry => entry.value)) : null,
    belowThreshold,
    belowDebtService,
    failures: describe(belowThreshold),
    shortfalls: describe(belowDebtService),
    path: years.map(entry => `Year ${entry.year}: ${entry.value === null ? "not available" : `${entry.value.toFixed(2)}x`}`).join("; "),
    declining: known.some(entry => {
      const previous = years[entry.year - 2]?.value;
      return previous != null && entry.value < previous;
    }),
    increasing: missing.length === 0 && known[1].value > known[0].value && known[2].value > known[1].value,
  };
}
