import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { geminiShadowAnalyze } =
  require("../geminiAdapter") as typeof import("../geminiAdapter");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../../lib/ai/gateway") as typeof import("../../../lib/ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

const CTX = {
  role: "banker" as const,
  path: "/deals/123",
  recentSignals: [],
};

beforeEach(() => {
  __setProviderImplForTests("openai", async () => {
    throw new Error("openai fallback not configured in this test");
  });
});

after(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

test("happy path: parses JSON text into resultJson and threads authMode/model through", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req) => {
    captured = req;
    return okResult('{"intent":"reassure","missing":null,"notes":"ok","confidence":0.8}');
  });

  const out = await geminiShadowAnalyze(CTX);

  assert.equal(captured.authMode, "vertex");
  assert.deepEqual(out.resultJson, {
    intent: "reassure",
    missing: null,
    notes: "ok",
    confidence: 0.8,
  });
});

test("non-JSON model output: falls back to a low-confidence unknown result, does not throw", async () => {
  __setProviderImplForTests("google", async () => okResult("not json at all"));
  const out = await geminiShadowAnalyze(CTX);
  assert.equal(out.resultJson.intent, "unknown");
  assert.equal(out.resultJson.notes, "non-json response");
});

test("gateway failure (both chain steps down): returns a generic error resultJson, never throws", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });
  const out = await geminiShadowAnalyze(CTX);
  assert.equal(out.resultJson.intent, "unknown");
  assert.equal(out.resultJson.notes, "error");
  assert.equal(out.resultJson.confidence, 0);
});
