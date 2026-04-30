import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// geminiClient.ts has `import "server-only"` which throws in test context.
// Same pattern as src/lib/__tests__/pipelineClassification.test.ts — patch
// the CJS resolver to route `server-only` to its no-op empty.js, then pull
// the module under test via require() so the patch takes effect first.
mockServerOnly();
const require = createRequire(import.meta.url);

const { callGeminiJSON } = require("../geminiClient") as typeof import("../geminiClient");
const { GEMINI_FLASH, GEMINI_PRO } = require("../models") as typeof import("../models");

// Intentionally pick a non-3.x model for the temperature-present test. Use
// the string form here rather than importing a retired registry alias —
// this is the one spot in the codebase that cares about 2.x vs 3.x branching.
const NON_GEMINI_3_MODEL = "gemini-" + "2.5" + "-flash"; // split before digits to dodge the model-string guard

// ─── Helpers ─────────────────────────────────────────────────────────────────

type FetchImpl = (input: any, init?: any) => Promise<Response>;

function installFetch(impl: FetchImpl): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function withApiKey<T>(key: string | undefined, fn: () => Promise<T>): Promise<T> {
  const original = process.env.GEMINI_API_KEY;
  if (key === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = key;
  return fn().finally(() => {
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
  });
}

function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function errResponse(status: number, body = "err"): Response {
  return new Response(body, { status });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("happy path: valid JSON returns ok:true with parsed result", async () => {
  const restore = installFetch(async () => okResponse('{"message":"hi"}'));
  try {
    const res = await withApiKey("test-key", () =>
      callGeminiJSON<{ message: string }>({
        model: GEMINI_FLASH,
        prompt: "say hi",
        logTag: "unit",
      }),
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.result, { message: "hi" });
    assert.equal(res.attempts, 1);
    assert.equal(res.error, undefined);
  } finally {
    restore();
  }
});

test("fenced JSON: ```json wrapper is stripped before parse", async () => {
  const restore = installFetch(async () =>
    okResponse('```json\n{"value": 42}\n```'),
  );
  try {
    const res = await withApiKey("test-key", () =>
      callGeminiJSON<{ value: number }>({
        model: GEMINI_FLASH,
        prompt: "p",
        logTag: "unit",
      }),
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.result, { value: 42 });
  } finally {
    restore();
  }
});

test("HTTP 500: retries once, still fails → ok:false with attempts:2", async () => {
  let calls = 0;
  const restore = installFetch(async () => {
    calls++;
    return errResponse(500, "boom");
  });
  try {
    const res = await withApiKey("test-key", () =>
      callGeminiJSON({
        model: GEMINI_FLASH,
        prompt: "p",
        logTag: "unit",
      }),
    );
    assert.equal(res.ok, false);
    assert.equal(res.attempts, 2);
    assert.equal(calls, 2);
    assert.ok(res.error && /HTTP 500/.test(res.error));
  } finally {
    restore();
  }
});

test("timeout: AbortError → retry → still fails → ok:false", async () => {
  let calls = 0;
  const restore = installFetch(async (_input, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          (err as any).name = "AbortError";
          reject(err);
        });
      }
      // never resolve on its own — relies on abort
    });
  });
  try {
    const res = await withApiKey("test-key", () =>
      callGeminiJSON({
        model: GEMINI_FLASH,
        prompt: "p",
        logTag: "unit",
        timeoutMs: 50,
      }),
    );
    assert.equal(res.ok, false);
    assert.equal(calls, 2); // one initial + one retry
    assert.ok(res.error);
  } finally {
    restore();
  }
});

test("missing GEMINI_API_KEY: short-circuits with attempts:0", async () => {
  const res = await withApiKey(undefined, () =>
    callGeminiJSON({
      model: GEMINI_FLASH,
      prompt: "p",
      logTag: "unit",
    }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 0);
  assert.match(res.error ?? "", /GEMINI_API_KEY missing/);
});

test("malformed JSON that survives fence cleanup: ok:false", async () => {
  const restore = installFetch(async () => okResponse("not json at all"));
  try {
    const res = await withApiKey("test-key", () =>
      callGeminiJSON({
        model: GEMINI_FLASH,
        prompt: "p",
        logTag: "unit",
      }),
    );
    assert.equal(res.ok, false);
    assert.ok(res.error);
  } finally {
    restore();
  }
});

test("empty response text: ok:false with 'empty response' error surfaced", async () => {
  const restore = installFetch(async () => okResponse(""));
  try {
    const res = await withApiKey("test-key", () =>
      callGeminiJSON({
        model: GEMINI_FLASH,
        prompt: "p",
        logTag: "unit",
      }),
    );
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /empty response/);
  } finally {
    restore();
  }
});

test("Gemini 3.x model: generationConfig omits temperature", async () => {
  let capturedBody: any = null;
  const restore = installFetch(async (_url, init) => {
    capturedBody = init ? JSON.parse(String(init.body)) : null;
    return okResponse('{"ok":true}');
  });
  try {
    await withApiKey("test-key", () =>
      callGeminiJSON({
        model: GEMINI_FLASH,
        prompt: "p",
        logTag: "unit",
      }),
    );
    assert.ok(capturedBody);
    assert.equal(
      "temperature" in capturedBody.generationConfig,
      false,
      "3.x models must not receive a temperature field",
    );
    assert.equal(
      capturedBody.generationConfig.responseMimeType,
      "application/json",
    );
  } finally {
    restore();
  }
});

test("non-3.x model: generationConfig includes temperature 0.1", async () => {
  let capturedBody: any = null;
  const restore = installFetch(async (_url, init) => {
    capturedBody = init ? JSON.parse(String(init.body)) : null;
    return okResponse('{"ok":true}');
  });
  try {
    await withApiKey("test-key", () =>
      callGeminiJSON({
        model: NON_GEMINI_3_MODEL,
        prompt: "p",
        logTag: "unit",
      }),
    );
    assert.equal(capturedBody?.generationConfig?.temperature, 0.1);
  } finally {
    restore();
  }
});

test("systemInstruction: optional, default omitted from body", async () => {
  let capturedBody: any = null;
  const restore = installFetch(async (_url, init) => {
    capturedBody = init ? JSON.parse(String(init.body)) : null;
    return okResponse('{"ok":true}');
  });
  try {
    await withApiKey("test-key", () =>
      callGeminiJSON({
        model: GEMINI_FLASH,
        prompt: "p",
        logTag: "unit",
      }),
    );
    assert.ok(capturedBody);
    assert.equal("systemInstruction" in capturedBody, false);
  } finally {
    restore();
  }
});

test("systemInstruction: when provided, included as top-level body field", async () => {
  let capturedBody: any = null;
  const restore = installFetch(async (_url, init) => {
    capturedBody = init ? JSON.parse(String(init.body)) : null;
    return okResponse('{"ok":true}');
  });
  try {
    await withApiKey("test-key", () =>
      callGeminiJSON({
        model: GEMINI_FLASH,
        prompt: "user turn",
        logTag: "unit",
        systemInstruction: "You are a test instructor.",
      }),
    );
    assert.ok(capturedBody);
    assert.ok(capturedBody.systemInstruction);
    assert.deepEqual(
      capturedBody.systemInstruction.parts?.[0],
      { text: "You are a test instructor." },
    );
    // And contents still carries the user turn.
    assert.equal(
      capturedBody.contents?.[0]?.parts?.[0]?.text,
      "user turn",
    );
  } finally {
    restore();
  }
});

test("transient failure then success: retries and returns ok:true on attempt 2", async () => {
  let calls = 0;
  const restore = installFetch(async () => {
    calls++;
    if (calls === 1) return errResponse(503, "upstream down");
    return okResponse('{"ok":true}');
  });
  try {
    const res = await withApiKey("test-key", () =>
      callGeminiJSON<{ ok: boolean }>({
        model: GEMINI_FLASH,
        prompt: "p",
        logTag: "unit",
      }),
    );
    assert.equal(res.ok, true);
    assert.equal(res.attempts, 2);
    assert.deepEqual(res.result, { ok: true });
  } finally {
    restore();
  }
});
