import "server-only";

import { matchChecklistKeyFromFilename } from "@/lib/checklist/matchers";

/**
 * Minimal filename → checklist_key inference.
 *
 * This is intentionally conservative; it returns null when confidence is low.
 * It can be upgraded later to use OCR/doc_intel.
 */
export function inferChecklistKey(filename: string): string | null {
  const m = matchChecklistKeyFromFilename(filename || "");
  if (!m.matchedKey) return null;
  if ((m.confidence ?? 0) < 0.6) return null;
  return m.matchedKey;
}
