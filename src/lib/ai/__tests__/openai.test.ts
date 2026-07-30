import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// openai.ts has `assertServerOnly()` at module load — same pattern as
// geminiClient.test.ts: patch the CJS resolver so server-only checks pass,
// then require() the module under test.
mockServerOnly();
const require = createRequire(import.meta.url);

const { aiJson } = require("../openai") as typeof import("../openai");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../gateway") as typeof import("../gateway");

// SPEC-M1.1 note: openai.ts (filename retained for import stability; it has
// called Gemini since Phase 93) now routes through runRole("generator", ...).
// The generator role's chain is google-primary with an openai fallback, so
// tests that simulate "the call fails" mock BOTH provider impls — the
// JSON-repair retry loop tested here is a distinct, higher layer than the
// gateway's own cross-provider failover.

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

function failingOpenAI() {
  return async () => {
    throw new Error("openai fallback not configured in this test");
  };
}

const BASE_ARGS = {
  scope: "test_scope",
  action: "test_action",
  system: "You are a test system.",
  user: "Produce the object.",
  jsonSchemaHint: '{"message": "string"}',
};

let originalApiKey: string | undefined;

before(() => {
  originalApiKey = process.env.GEMINI_API_KEY;
  __setProviderImplForTests("openai", failingOpenAI());
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.AI_GATEWAY_BUDGET_GENERATOR;
  delete process.env.AI_MAX_RETRIES;
  __setProviderImplForTests("openai", failingOpenAI());
});

after(() => {
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

test("happy path: valid JSON on first attempt returns ok:true", async () => {
  __setProviderImplForTests("google", async () => okResult('{"message":"hi","confidence":90}'));
  const res = await aiJson<{ message: string }>(BASE_ARGS);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.result, { message: "hi", confidence: 90 });
    assert.equal(res.confidence, 90);
    assert.equal(res.requires_human_review, false);
  }
});

test("missing GEMINI_API_KEY: returns a schema-shaped fallback with ok:true and requires_human_review:true", async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const res = await aiJson(BASE_ARGS);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.deepEqual(res.result, { message: "string" });
      assert.equal(res.confidence, 10);
      assert.equal(res.requires_human_review, true);
      assert.equal(res.evidence?.[0]?.kind, "system_note");
    }
  } finally {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  }
});

test("malformed JSON: extracts the first balanced JSON object embedded in extra text", async () => {
  __setProviderImplForTests("google", async () =>
    okResult('Here you go:\n{"message":"embedded","confidence":80}\nHope that helps!'),
  );
  const res = await aiJson<{ message: string }>(BASE_ARGS);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.result.message, "embedded");
});

test("invalid JSON with no extractable object: repair call fixes it, ok:true", async () => {
  let call = 0;
  __setProviderImplForTests("google", async () => {
    call++;
    if (call === 1) return okResult("not json at all, no braces here");
    // The repair call (purpose: ai_json_repair) is the 2nd google call.
    return okResult('{"message":"repaired","confidence":60}');
  });
  const res = await aiJson<{ message: string }>(BASE_ARGS);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.result.message, "repaired");
    assert.equal(res.requires_human_review, true); // confidence 60 < 85
  }
});

test("network/HTTP failure from the gateway short-circuits immediately with ok:false (no repair-loop retry)", async () => {
  // Both providers must fail identically since generator's chain fails
  // over from google to openai — the surfaced error is whichever step
  // failed last.
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });
  const res = await aiJson(BASE_ARGS);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /HTTP 500/);
});

test("all attempts produce unparseable JSON: ok:false with AI_JSON_PARSE_FAILED_AFTER_RETRIES", async () => {
  process.env.AI_MAX_RETRIES = "0";
  __setProviderImplForTests("google", async () => okResult("still not json"));
  const res = await aiJson(BASE_ARGS);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, "AI_JSON_PARSE_FAILED_AFTER_RETRIES");
});

test("model override: a caller-supplied model is threaded through to the gateway and the result", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req) => {
    captured = req;
    return okResult('{"message":"ok"}');
  });
  const res = await aiJson({ ...BASE_ARGS, model: "gemini-2.5-pro" });
  assert.equal(captured.model, "gemini-2.5-pro");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.model, "gemini-2.5-pro");
});
