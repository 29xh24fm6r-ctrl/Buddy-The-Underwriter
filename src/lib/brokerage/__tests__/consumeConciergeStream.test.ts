import test from "node:test";
import assert from "node:assert/strict";
import { consumeConciergeStream } from "../consumeConciergeStream";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

test("delivers tokens in order and calls onDone with the final payload", async () => {
  const tokens: string[] = [];
  let doneData: any = null;

  await consumeConciergeStream(
    streamFromChunks([
      'event: token\ndata: {"text":"Hi Matt, "}\n\n',
      'event: token\ndata: {"text":"what business are you financing?"}\n\n',
      'event: done\ndata: {"ok":true,"assistantMessage":"Hi Matt, what business are you financing?","progressPct":20}\n\n',
    ]),
    {
      onToken: (t) => tokens.push(t),
      onDone: (d) => (doneData = d),
      onError: () => assert.fail("onError should not fire"),
    },
  );

  assert.deepEqual(tokens, ["Hi Matt, ", "what business are you financing?"]);
  assert.equal(doneData.ok, true);
  assert.equal(doneData.progressPct, 20);
});

test("handles an SSE frame split across two chunk reads", async () => {
  const tokens: string[] = [];
  let doneData: any = null;

  await consumeConciergeStream(
    streamFromChunks([
      'event: token\ndata: {"te',
      'xt":"hello"}\n\n',
      'event: done\ndata: {"ok":true}\n\n',
    ]),
    {
      onToken: (t) => tokens.push(t),
      onDone: (d) => (doneData = d),
      onError: () => assert.fail("onError should not fire"),
    },
  );

  assert.deepEqual(tokens, ["hello"]);
  assert.equal(doneData.ok, true);
});

test("calls onError when the stream ends without a done event", async () => {
  let errorMessage: string | null = null;

  await consumeConciergeStream(streamFromChunks(['event: token\ndata: {"text":"partial"}\n\n']), {
    onToken: () => {},
    onDone: () => assert.fail("onDone should not fire"),
    onError: (msg) => (errorMessage = msg),
  });

  assert.equal(errorMessage, "stream_ended_without_done");
});

test("calls onError with the server's message on an error event", async () => {
  let errorMessage: string | null = null;

  await consumeConciergeStream(
    streamFromChunks(['event: error\ndata: {"message":"gemini_timeout"}\n\n']),
    {
      onToken: () => {},
      onDone: () => assert.fail("onDone should not fire"),
      onError: (msg) => (errorMessage = msg),
    },
  );

  assert.equal(errorMessage, "gemini_timeout");
});

test("skips a malformed token frame instead of throwing", async () => {
  const tokens: string[] = [];
  let doneData: any = null;

  await consumeConciergeStream(
    streamFromChunks([
      "event: token\ndata: not-json\n\n",
      'event: token\ndata: {"text":"ok"}\n\n',
      'event: done\ndata: {"ok":true}\n\n',
    ]),
    {
      onToken: (t) => tokens.push(t),
      onDone: (d) => (doneData = d),
      onError: () => assert.fail("onError should not fire"),
    },
  );

  assert.deepEqual(tokens, ["ok"]);
  assert.equal(doneData.ok, true);
});
