/**
 * Shared text utilities for the Classification Spine.
 *
 * Pure functions — no server-only, no DB, no API.
 * Logic lifted from src/lib/artifacts/classifyByRules.ts with
 * additions for the normalization layer.
 */

// ---------------------------------------------------------------------------
// Tax Year Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the most likely tax year from document text.
 * Searches the first 2000 chars for explicit tax year patterns,
 * then falls back to the most recent 4-digit year in first 500 chars.
 */
export function extractTaxYear(text: string): number | null {
  const head = text.slice(0, 2000);

  // Explicit: "Tax Year 2023", "For the Year Ended 2023", "For tax year 2023"
  const explicit = head.match(
    /(?:tax\s+year|for\s+(?:the\s+)?year(?:\s+ended)?)\s*:?\s*(20[12]\d)/i,
  );
  if (explicit) return Number(explicit[1]);

  // Calendar year: "December 31, 2023", "12/31/2023"
  const calYear = head.match(/(?:december\s+31|12\/31)[,\s]+(\d{4})/i);
  if (calYear) return Number(calYear[1]);

  // Fallback: find 4-digit years in reasonable range in first 500 chars
  const shortHead = head.slice(0, 500);
  const years = [...shortHead.matchAll(/\b(20[12]\d)\b/g)].map((m) =>
    Number(m[1]),
  );
  if (years.length > 0) {
    return Math.max(...years);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Form Number Extraction
// ---------------------------------------------------------------------------

/**
 * Extract IRS/government form numbers from document text.
 * Searches the first 3000 chars.
 */
export function extractFormNumbers(text: string): string[] {
  const head = text.slice(0, 3000);
  const forms = new Set<string>();

  const patterns: Array<[RegExp, string]> = [
    [/Form\s+1040/i, "1040"],
    [/Form\s+1120S\b/i, "1120S"],
    [/Form\s+1120\b/i, "1120"],
    [/Form\s+1065/i, "1065"],
    [/Schedule\s+K-?1/i, "K-1"],
    [/Schedule\s+C\b/i, "Schedule C"],
    [/Schedule\s+E\b/i, "Schedule E"],
    [/Form\s+W-?2/i, "W-2"],
    [/Form\s+1099/i, "1099"],
  ];

  for (const [pattern, name] of patterns) {
    if (pattern.test(head)) forms.add(name);
  }

  return forms.size > 0 ? [...forms] : [];
}

// ---------------------------------------------------------------------------
// Year Detection (for normalization)
// ---------------------------------------------------------------------------

/**
 * Extract all detected 4-digit years from document text.
 * Returns unique years in descending order (most recent first).
 */
export function extractDetectedYears(text: string): number[] {
  const matches = [...text.matchAll(/\b(20[12]\d)\b/g)].map((m) =>
    Number(m[1]),
  );
  const unique = [...new Set(matches)];
  unique.sort((a, b) => b - a);
  return unique;
}
