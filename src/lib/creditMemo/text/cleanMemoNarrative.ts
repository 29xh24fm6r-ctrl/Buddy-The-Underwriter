/**
 * Memo Narrative Text Cleaner
 *
 * Normalizes concatenated narrative text for committee presentation.
 * Pure function — no DB, no server-only.
 */

/** Collapse repeated whitespace to single space. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Remove trailing punctuation (.!?) but preserve abbreviations and decimals. */
export function trimTerminalPunctuation(text: string): string {
  return text.replace(/([^0-9])[.!?]+\s*$/, "$1").trim();
}

/**
 * Join non-empty parts with ". " after trimming existing terminal punctuation.
 * Final output ends with one period.
 */
export function joinSentences(parts: Array<string | null | undefined>): string {
  const clean = parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => trimTerminalPunctuation(normalizeWhitespace(p)));

  if (clean.length === 0) return "";
  return clean.join(". ") + ".";
}

/**
 * Full narrative cleanup: collapse whitespace, fix double periods,
 * remove orphan punctuation, preserve decimals/money.
 */
export function cleanMemoNarrative(text: string): string {
  let result = normalizeWhitespace(text);
  // Fix double periods (but not decimals like $1.5M or 1.25x)
  result = result.replace(/([^0-9])\.\s*\.+/g, "$1.");
  // Fix ". ." pattern
  result = result.replace(/\.\s+\./g, ".");
  // Fix ",." pattern
  result = result.replace(/,\s*\./g, ".");
  // Fix ".. " pattern mid-sentence
  result = result.replace(/\.{2,}\s/g, ". ");
  // Collapse multiple periods at end
  result = result.replace(/\.{2,}$/g, ".");
  return result.trim();
}
