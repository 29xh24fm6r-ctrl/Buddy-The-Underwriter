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
