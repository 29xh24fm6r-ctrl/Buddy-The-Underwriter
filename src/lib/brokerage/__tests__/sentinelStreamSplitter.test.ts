import test from "node:test";
import assert from "node:assert/strict";
import { createSentinelSplitter } from "../sentinelStreamSplitter";

const SENTINEL = "\n===SPLIT===\n";

test("flushes text immediately when nothing is near the sentinel", () => {
  const s = createSentinelSplitter(SENTINEL);
  const shown = s.feed("Hello there, ");
  // Held back because it's shorter than the sentinel and could still be
  // extended into one — this is a single short feed, so nothing is safe yet
  // only once enough trails past the holdback window.
  assert.equal(shown, "");
  const { messageText, trailingToShow, factsRaw } = s.finish();
  assert.equal(messageText, "Hello there,");
  assert.equal(trailingToShow, "Hello there, ");
  assert.equal(factsRaw, null);
});

test("flushes safely once enough text has accumulated past the holdback window", () => {
  const s = createSentinelSplitter(SENTINEL);
  const shown = s.feed("A".repeat(50));
  assert.equal(shown.length, 50 - SENTINEL.length);
});

test("detects a sentinel that arrives whole in one feed", () => {
  const s = createSentinelSplitter(SENTINEL);
  s.feed("Hi Matt!");
  const shown = s.feed(SENTINEL + '{"a":1}');
  assert.equal(shown, "Hi Matt!");
  const { messageText, trailingToShow, factsRaw } = s.finish();
  assert.equal(messageText, "Hi Matt!");
  assert.equal(trailingToShow, "");
  assert.equal(factsRaw, '{"a":1}');
});

test("detects a sentinel split across two feeds", () => {
  const s = createSentinelSplitter(SENTINEL);
  const half = Math.floor(SENTINEL.length / 2);
  // Some of "Hi Matt!" may already be safe to flush on the first feed
  // (whatever falls outside the holdback window) — accumulate across both
  // feeds rather than asserting on either one in isolation.
  const shown1 = s.feed("Hi Matt!" + SENTINEL.slice(0, half));
  const shown2 = s.feed(SENTINEL.slice(half) + '{"a":1}');
  assert.equal(shown1 + shown2, "Hi Matt!");
  const { messageText, factsRaw } = s.finish();
  assert.equal(messageText, "Hi Matt!");
  assert.equal(factsRaw, '{"a":1}');
});

test("never shows a byte that turns out to be part of the sentinel", () => {
  const s = createSentinelSplitter(SENTINEL);
  let shownSoFar = "";
  // Feed one character at a time through "Hi!" + the full sentinel.
  const source = "Hi!" + SENTINEL;
  for (const ch of source) {
    shownSoFar += s.feed(ch);
  }
  assert.equal(shownSoFar, "Hi!");
});

test("stream ends before the sentinel ever arrives — everything becomes trailing", () => {
  const s = createSentinelSplitter(SENTINEL);
  s.feed("partial reply with no facts block");
  const { messageText, trailingToShow, factsRaw } = s.finish();
  assert.equal(factsRaw, null);
  assert.equal(messageText, "partial reply with no facts block");
  assert.ok(trailingToShow.length > 0);
});

test("feed() after the sentinel is found is a no-op for showing text", () => {
  const s = createSentinelSplitter(SENTINEL);
  s.feed("Hello" + SENTINEL);
  const shown = s.feed('{"more":"facts"}');
  assert.equal(shown, "");
  const { factsRaw } = s.finish();
  assert.equal(factsRaw, '{"more":"facts"}');
});
