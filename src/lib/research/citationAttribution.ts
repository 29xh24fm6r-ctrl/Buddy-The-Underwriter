import type { GroundingSegment } from "./buddyIntelligenceEngine";

/**
 * Attributes a specific narrative/claim text to the subset of Gemini
 * grounding-support source URLs whose cited text segment actually overlaps
 * that text, instead of pooling every source cited anywhere in the thread.
 *
 * Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md: previously every
 * claim/section in a thread carried the *same* thread-wide source list, so a
 * Litigation and Risk sentence could be "backed" by a source that actually
 * supported an unrelated Company Overview sentence.
 */

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const MIN_SEGMENT_LENGTH = 20;

export function attributeSegmentsToText(
  fieldText: string,
  segments: GroundingSegment[],
  fallbackUrls: string[],
): string[] {
  if (!fieldText || segments.length === 0) return fallbackUrls;

  const normalizedField = normalizeForMatch(fieldText);
  if (!normalizedField) return fallbackUrls;

  const matchedUrls = new Set<string>();
  for (const seg of segments) {
    if (!seg.text || seg.text.trim().length < MIN_SEGMENT_LENGTH) continue;
    const normalizedSeg = normalizeForMatch(seg.text);
    if (normalizedField.includes(normalizedSeg) || normalizedSeg.includes(normalizedField)) {
      for (const u of seg.urls) matchedUrls.add(u);
    }
  }

  return matchedUrls.size > 0 ? [...matchedUrls] : fallbackUrls;
}
