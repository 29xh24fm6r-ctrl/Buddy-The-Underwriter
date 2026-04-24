/**
 * Pure sanitizer for ownership_entities.display_name values.
 *
 * Strips PDF/OCR label-bleed garbage (e.g. "MICHAEL NEWMARK\nTaxpayer address")
 * to a clean name ("MICHAEL NEWMARK"). See STUCK-SPREADS Batch 2 (2026-04-23).
 *
 * Returns null for values that are empty or too short after cleaning.
 * Callers should skip the write (or fall back to a sentinel) when null.
 */

const LABEL_SUFFIX_PATTERNS = [
  /\s+(taxpayer|spouse|filer|name|address|ssn|date)\b.*$/i,
  /\s+(date of birth|dob|tax id)\b.*$/i,
];

export function sanitizeEntityName(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  // First newline split — label bleed almost always manifests as a name
  // followed by a newline followed by a PDF form label.
  const firstLine = raw.split(/\r?\n/)[0]!.trim();
  if (!firstLine) return null;

  let cleaned = firstLine;
  for (const pat of LABEL_SUFFIX_PATTERNS) {
    cleaned = cleaned.replace(pat, "");
  }

  // Collapse repeated whitespace and trim.
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  if (cleaned.length < 2) return null;
  return cleaned;
}
