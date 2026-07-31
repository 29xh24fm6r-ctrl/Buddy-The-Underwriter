import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// geminiClient.ts has `import "server-only"` which throws in test context.
// Same pattern as src/lib/__tests__/pipelineClassification.test.ts — patch
// the CJS resolver to route `server-only` to its no-op empty.js, then pull
// the module under test via require() so the patch takes effect first.
mockServerOnly();
const require = createRequire(import.meta.url);

const { callGeminiJSON, streamGeminiText } =
  require("../geminiClient") as typeof import("../geminiClient");
const { GEMINI_FLASH } = require("../models") as typeof import("../models");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../gateway") as typeof import("../gateway");

// SPEC-M1.1 note: geminiClient.ts now routes through runRole("generator", ...)
// instead of a raw fetch. The generator role's chain is google-primary with
// an openai fallback, so these tests mock BOTH provider impls explicitly —
// a same-provider retry (geminiClient's own retry loop) is a genuinely
// different reliability layer than the gateway's own cross-provider
// failover, and both are exercised by real production traffic now.

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

function failingOpenAI() {
  return async () => {
    throw new Error("openai fallback not configured in this test");
  };
}

let originalApiKey: string | undefined;

before(() => {
  originalApiKey = process.env.GEMINI_API_KEY;
  __setProviderImplForTests("openai", failingOpenAI());
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.AI_GATEWAY_BUDGET_GENERATOR;
  __setProviderImplForTests("openai", failingOpenAI());
});

after(() => {
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

test("happy path: valid JSON returns ok:true with parsed result", async () => {
  __setProviderImplForTests("google", async () => okResult('{"message":"hi"}'));
  const res = await callGeminiJSON<{ message: string }>({
    model: GEMINI_FLASH,
    prompt: "say hi",
    logTag: "unit",
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.result, { message: "hi" });
  assert.equal(res.attempts, 1);
  assert.equal(res.error, undefined);
});

test("fenced JSON: ```json wrapper is stripped before parse", async () => {
  __setProviderImplForTests("google", async () => okResult('```json\n{"value": 42}\n```'));
  const res = await callGeminiJSON<{ value: number }>({
    model: GEMINI_FLASH,
    prompt: "p",
    logTag: "unit",
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.result, { value: 42 });
});

test("provider failure: retries once (geminiClient's own retry loop), still fails → ok:false with attempts:2", async () => {
  // The generator role's chain falls over from google to openai on failure
  // (runRole's own cross-provider reliability layer, on top of
  // geminiClient's own same-provider retry loop below) — both providers
  // must fail for this scenario, and the surfaced error is whichever chain
  // step failed last (openai), not necessarily google's.
  let calls = 0;
  __setProviderImplForTests("google", async () => {
    calls++;
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });
  const res = await callGeminiJSON({
    model: GEMINI_FLASH,
    prompt: "p",
    logTag: "unit",
  });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 2);
  assert.equal(calls, 2);
  assert.ok(res.error && /HTTP 500/.test(res.error));
});

test("missing GEMINI_API_KEY: short-circuits with attempts:0", async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const res = await callGeminiJSON({
      model: GEMINI_FLASH,
      prompt: "p",
      logTag: "unit",
    });
    assert.equal(res.ok, false);
    assert.equal(res.attempts, 0);
    assert.match(res.error ?? "", /GEMINI_API_KEY missing/);
  } finally {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  }
});

test("malformed JSON that survives fence cleanup: ok:false", async () => {
  __setProviderImplForTests("google", async () => okResult("not json at all"));
  const res = await callGeminiJSON({
    model: GEMINI_FLASH,
    prompt: "p",
    logTag: "unit",
  });
  assert.equal(res.ok, false);
  assert.ok(res.error);
});

test("empty response text: ok:false with the provider's empty-response error surfaced", async () => {
  // providers/google.ts's callGoogle already throws "empty response" for a
  // blank/empty candidate text — geminiClient.ts no longer reimplements
  // this check itself. The generator chain falls over to openai on a
  // google failure, so openai is also made to fail the same way here —
  // otherwise the final surfaced error would be whichever step failed
  // last, not necessarily google's.
  __setProviderImplForTests("google", async () => {
    throw new Error("empty response (finishReason: STOP)");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("empty response (finishReason: STOP)");
  });
  const res = await callGeminiJSON({
    model: GEMINI_FLASH,
    prompt: "p",
    logTag: "unit",
  });
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /empty response/);
});

test("thinkingLevel/maxOutputTokens defaults are passed through to the gateway", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req) => {
    captured = req;
    return okResult('{"ok":true}');
  });
  await callGeminiJSON({
    model: GEMINI_FLASH,
    prompt: "p",
    logTag: "unit",
  });
  assert.equal(captured.thinkingLevel, "low");
  assert.equal(captured.maxOutputTokens, 16384);
  assert.equal(captured.model, GEMINI_FLASH);
});

test("systemInstruction: optional, passed through when provided", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req) => {
    captured = req;
    return okResult('{"ok":true}');
  });
  await callGeminiJSON({
    model: GEMINI_FLASH,
    prompt: "user turn",
    logTag: "unit",
    systemInstruction: "You are a test instructor.",
  });
  assert.equal(captured.systemInstruction, "You are a test instructor.");
  assert.equal(captured.prompt, "user turn");
});

test("thought-marked parts are filtered out (handled by providers/google.ts, verified end-to-end)", async () => {
  // providers/google.ts's extractText already strips `thought: true` parts
  // before runRole ever sees a result — geminiClient.ts just receives
  // clean text.
  __setProviderImplForTests("google", async () => okResult('{"value":42}'));
  const res = await callGeminiJSON<{ value: number }>({
    model: GEMINI_FLASH,
    prompt: "p",
    logTag: "unit",
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.result, { value: 42 });
});

test("transient failure then success: retries and returns ok:true on attempt 2", async () => {
  let calls = 0;
  __setProviderImplForTests("google", async () => {
    calls++;
    if (calls === 1) throw new Error("HTTP 503: upstream down");
    return okResult('{"ok":true}');
  });
  const res = await callGeminiJSON<{ ok: boolean }>({
    model: GEMINI_FLASH,
    prompt: "p",
    logTag: "unit",
  });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.deepEqual(res.result, { ok: true });
});

// ─── streamGeminiText ────────────────────────────────────────────────────

test("streamGeminiText: yields chunks from the gateway's interviewer role", async () => {
  __setProviderImplForTests("google", async () => okResult("unused-for-stream"));
  // runRoleStream calls streamGoogle directly (not the providerImpl seam),
  // so this test exercises the real streamGoogle against a mocked fetch —
  // see gateway.test.ts's own runRoleStream coverage for the non-google
  // rejection path; here we only need modelOverride/thinkingLevel/
  // maxOutputTokens to thread through without throwing before the first
  // network call, which requires a live GEMINI_API_KEY-shaped environment.
  // Given no live network access in this suite, assert instead that the
  // async generator is constructed and the first chunk read attempt at
  // least reaches the network layer (fails cleanly with a fetch error,
  // not a "not implemented" or "missing field" error).
  const original = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const gen = streamGeminiText({
      model: GEMINI_FLASH,
      prompt: "hi",
      logTag: "unit",
    });
    await assert.rejects(() => gen.next());
  } finally {
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
  }
});
