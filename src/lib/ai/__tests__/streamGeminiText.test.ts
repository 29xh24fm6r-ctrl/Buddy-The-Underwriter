import test from "node:test";
import assert from "node:assert/strict";
import { streamGeminiText } from "../geminiClient";

function fakeGeminiSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
  return new Response(body, { status: 200 });
}

test("streamGeminiText yields text deltas parsed from Gemini's SSE shape", async (t) => {
  process.env.GEMINI_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    fakeGeminiSSEResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi Matt, "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"what are you financing?"}]}}]}\n\n',
    ])) as unknown as typeof fetch;

  const deltas: string[] = [];
  for await (const delta of streamGeminiText({
    model: "gemini-3.5-flash",
    prompt: "hello",
    logTag: "test",
  })) {
    deltas.push(delta);
  }

  assert.deepEqual(deltas, ["Hi Matt, ", "what are you financing?"]);
});

test("streamGeminiText skips malformed SSE data lines without throwing", async (t) => {
  process.env.GEMINI_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    fakeGeminiSSEResponse([
      "data: not-json\n\n",
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n',
    ])) as unknown as typeof fetch;

  const deltas: string[] = [];
  for await (const delta of streamGeminiText({
    model: "gemini-3.5-flash",
    prompt: "hello",
    logTag: "test",
  })) {
    deltas.push(delta);
  }

  assert.deepEqual(deltas, ["ok"]);
});

test("streamGeminiText throws when the HTTP response is not ok", async (t) => {
  process.env.GEMINI_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response("rate limited", { status: 429 })) as unknown as typeof fetch;

  await assert.rejects(async () => {
    for await (const _ of streamGeminiText({
      model: "gemini-3.5-flash",
      prompt: "hello",
      logTag: "test",
    })) {
      // no-op
    }
  }, /HTTP 429/);
});

test("streamGeminiText throws when GEMINI_API_KEY is missing", async (t) => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  t.after(() => {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  });

  await assert.rejects(async () => {
    for await (const _ of streamGeminiText({
      model: "gemini-3.5-flash",
      prompt: "hello",
      logTag: "test",
    })) {
      // no-op
    }
  }, /GEMINI_API_KEY missing/);
});
