import test from "node:test";
import assert from "node:assert/strict";
import { splitSSEEvents } from "../parseSSEBuffer";

test("parses a single complete frame with event + data", () => {
  const { events, rest } = splitSSEEvents('event: token\ndata: {"text":"hi"}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "token");
  assert.equal(events[0].data, '{"text":"hi"}');
  assert.equal(rest, "");
});

test("defaults event to 'message' when no event: line is present", () => {
  const { events } = splitSSEEvents('data: {"a":1}\n\n');
  assert.equal(events[0].event, "message");
});

test("leaves an incomplete trailing frame in rest", () => {
  const { events, rest } = splitSSEEvents('event: token\ndata: {"text":"a"}\n\nevent: tok');
  assert.equal(events.length, 1);
  assert.equal(rest, "event: tok");
});

test("parses multiple frames arriving in one buffer", () => {
  const buf =
    'event: token\ndata: {"text":"a"}\n\n' +
    'event: token\ndata: {"text":"b"}\n\n' +
    'event: done\ndata: {"ok":true}\n\n';
  const { events, rest } = splitSSEEvents(buf);
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => e.event),
    ["token", "token", "done"],
  );
  assert.equal(rest, "");
});

test("joins multi-line data fields with newlines", () => {
  const { events } = splitSSEEvents("data: line1\ndata: line2\n\n");
  assert.equal(events[0].data, "line1\nline2");
});

test("skips a frame with no data lines", () => {
  const { events, rest } = splitSSEEvents("event: ping\n\ndata: {}\n\n");
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "message");
  assert.equal(events[0].data, "{}");
  assert.equal(rest, "");
});

test("empty buffer yields no events and empty rest", () => {
  const { events, rest } = splitSSEEvents("");
  assert.equal(events.length, 0);
  assert.equal(rest, "");
});

// INCIDENT REGRESSION (2026-07-22): the concierge-chat "model produced no
// reply text" bug traced all the way back to this function only matching
// bare "\n\n" frame boundaries. Gemini's real streamGenerateContent SSE
// response uses CRLF line endings, so real HTTP 200 responses with ~19KB of
// legitimate data across dozens of chunks yielded zero parsed events, every
// time, from the very first request onward. #727-#729 were all fixing a
// real-but-secondary generationConfig issue while this was the actual bug.

test("parses a single complete frame with CRLF line endings", () => {
  const { events, rest } = splitSSEEvents(
    'event: token\r\ndata: {"text":"hi"}\r\n\r\n',
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "token");
  assert.equal(events[0].data, '{"text":"hi"}');
  assert.equal(rest, "");
});

test("parses multiple CRLF-framed frames arriving in one buffer", () => {
  const buf =
    'event: token\r\ndata: {"text":"a"}\r\n\r\n' +
    'event: token\r\ndata: {"text":"b"}\r\n\r\n' +
    'event: done\r\ndata: {"ok":true}\r\n\r\n';
  const { events, rest } = splitSSEEvents(buf);
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => e.event),
    ["token", "token", "done"],
  );
  assert.equal(rest, "");
});

test("leaves an incomplete trailing CRLF-framed frame in rest", () => {
  const { events, rest } = splitSSEEvents(
    'event: token\r\ndata: {"text":"a"}\r\n\r\nevent: tok',
  );
  assert.equal(events.length, 1);
  assert.equal(rest, "event: tok");
});

test("joins multi-line CRLF data fields with newlines", () => {
  const { events } = splitSSEEvents("data: line1\r\ndata: line2\r\n\r\n");
  assert.equal(events[0].data, "line1\nline2");
});

test("handles a mixed buffer of LF and CRLF frames (partial-chunk boundary)", () => {
  const buf =
    'event: token\ndata: {"text":"a"}\n\n' +
    'event: token\r\ndata: {"text":"b"}\r\n\r\n';
  const { events, rest } = splitSSEEvents(buf);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.data), ['{"text":"a"}', '{"text":"b"}']);
  assert.equal(rest, "");
});
