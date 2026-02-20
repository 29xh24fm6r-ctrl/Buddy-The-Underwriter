/**
 * extractFilenamePattern — strips PII tokens, keeps structural shape
 *
 * e.g. "John_Smith_1040_2023.pdf" → "*_*_1040_*.pdf"
 *
 * Used by both checklist-key route (cockpit) and intake per-doc confirm route
 * to emit Override Intelligence enrichment fields with consistent fingerprinting.
 *
 * Do NOT duplicate this logic. Import from this shared module.
 */
export function extractFilenamePattern(filename: string | null | undefined): string | null {
  if (!filename) return null;
  // Strip extension for processing, restore at end
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx >= 0 ? filename.slice(dotIdx) : "";
  const base = dotIdx >= 0 ? filename.slice(0, dotIdx) : filename;

  // Replace 4-digit years (1900-2099), UUIDs, and long digit sequences with *
  // then replace any remaining alpha-only token that looks like a name with *
  const normalized = base
    .replace(/\b(19|20)\d{2}\b/g, "*")                       // years
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "*") // UUID
    .replace(/\b\d{5,}\b/g, "*")                              // long digit sequences
    .replace(/\b[A-Za-z]{2,}\b(?=(_|\s|$))/g, (token) => {
      // Keep known form identifiers (all-caps or known IRS/SBA codes), mask the rest
      if (/^(1040|1120|1065|1099|W2|K1|PFS|BTR|PTR|SBA|T12)$/.test(token.toUpperCase())) {
        return token.toUpperCase();
      }
      return "*";
    })
    .replace(/\*+/g, "*");                                    // collapse consecutive *

  return normalized + ext;
}
