import test from "node:test";
import assert from "node:assert/strict";

import { attributeSegmentsToText } from "@/lib/research/citationAttribution";
import type { GroundingSegment } from "@/lib/research/buddyIntelligenceEngine";

/**
 * Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md: citations must be
 * specific to the text they support, not pooled across the whole thread.
 */

function seg(text: string, urls: string[]): GroundingSegment {
  return { text, urls, confidences: urls.map(() => 1) };
}

test("no segments → falls back to the thread-wide source list", () => {
  const fallback = ["https://a.example.com"];
  assert.deepEqual(attributeSegmentsToText("Some claim text here.", [], fallback), fallback);
});

test("empty field text → falls back", () => {
  const fallback = ["https://a.example.com"];
  assert.deepEqual(attributeSegmentsToText("", [seg("irrelevant", ["https://x.com"])], fallback), fallback);
});

test("matches only the segment whose text overlaps the field text", () => {
  const segments = [
    seg("The company was founded in 2010 and provides BPO services to healthcare clients.", ["https://bizjournals.com/a"]),
    seg("There is an active lawsuit alleging breach of contract filed in 2024.", ["https://courtlistener.com/b"]),
  ];
  const litigationText = "There is an active lawsuit alleging breach of contract filed in 2024.";
  const result = attributeSegmentsToText(litigationText, segments, ["https://fallback.com"]);
  assert.deepEqual(result, ["https://courtlistener.com/b"]);
});

test("short segments (< 20 chars) are ignored to avoid spurious substring matches", () => {
  const segments = [seg("BPO", ["https://short.com"])];
  const result = attributeSegmentsToText("A long field about BPO services and operations.", segments, ["https://fallback.com"]);
  assert.deepEqual(result, ["https://fallback.com"]);
});

test("no segment overlaps the field text → falls back to thread-wide sources", () => {
  const segments = [seg("Completely unrelated content about a different company entirely.", ["https://other.com"])];
  const result = attributeSegmentsToText("Our target company reported strong revenue growth this year.", segments, ["https://fallback.com"]);
  assert.deepEqual(result, ["https://fallback.com"]);
});

test("multiple matching segments merge their URLs, de-duplicated", () => {
  const fullText = "The company reported strong revenue growth this year. It also expanded into a new market segment recently.";
  const segments = [
    seg("The company reported strong revenue growth this year.", ["https://a.com"]),
    seg("It also expanded into a new market segment recently.", ["https://b.com", "https://a.com"]),
  ];
  const result = attributeSegmentsToText(fullText, segments, ["https://fallback.com"]);
  assert.equal(result.length, 2);
  assert.ok(result.includes("https://a.com"));
  assert.ok(result.includes("https://b.com"));
});
