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

test("streamGeminiText: Gemini 3.x model disables thinking and caps output tokens", async (t) => {
  // Regression test for the 2026-07-21 incident: gemini-3.5-flash's dynamic
  // thinking silently consumed the entire output budget on internal
  // reasoning, streaming zero visible text — every /start "Chat with Buddy"
  // turn fell back to the generic "didn't quite catch that" message.
  process.env.GEMINI_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let capturedBody: any = null;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    capturedBody = init ? JSON.parse(String(init.body)) : null;
    return fakeGeminiSSEResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n',
    ]);
  }) as unknown as typeof fetch;

  for await (const _ of streamGeminiText({
    model: "gemini-3.5-flash",
    prompt: "hello",
    logTag: "test",
  })) {
    // no-op — draining the generator
  }

  assert.deepEqual(capturedBody.generationConfig.thinkingConfig, {
    thinkingBudget: 0,
  });
  assert.equal(capturedBody.generationConfig.maxOutputTokens, 4096);
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
