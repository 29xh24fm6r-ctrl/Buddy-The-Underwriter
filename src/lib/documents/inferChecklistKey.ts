import "server-only";

import { matchChecklistKeyFromFilename } from "@/lib/checklist/matchers";

/** @deprecated Filename matching is deprecated — use AI classification via processArtifact instead. */
const FILENAME_MATCH_ENABLED = process.env.FILENAME_MATCH_ENABLED !== "false";

/**
 * Minimal filename → checklist_key inference.
 *
 * @deprecated Prefer AI classification (processArtifact pipeline). Filename matching
 * is retained as a fallback only. Disable with FILENAME_MATCH_ENABLED=false.
 */
export function inferChecklistKey(filename: string): string | null {
  if (!FILENAME_MATCH_ENABLED) return null;

  const m = matchChecklistKeyFromFilename(filename || "");
  if (!m.matchedKey) return null;
  if ((m.confidence ?? 0) < 0.6) return null;

  console.warn("[inferChecklistKey] DEPRECATED filename match used", {
    filename: filename?.slice(0, 60),
    matchedKey: m.matchedKey,
    confidence: m.confidence,
  });

  return m.matchedKey;
}
