import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { callGeminiJSON } =
  require("../sbaPackageNarrative") as typeof import("../sbaPackageNarrative");
const { parseNarrativeField } =
  require("../sbaPackageNarrative") as typeof import("../sbaPackageNarrative");
const { GEMINI_PRO } = require("../../ai/models") as typeof import("../../ai/models");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

let originalApiKey: string | undefined;

before(() => {
  originalApiKey = process.env.GEMINI_API_KEY;
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  __setProviderImplForTests("openai", async () => {
    throw new Error("openai fallback not configured in this test");
  });
});

after(() => {
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

test("happy path: returns the gateway's text verbatim", async () => {
  __setProviderImplForTests("google", async () => okResult('{"thesis":"hi"}'));
  const text = await callGeminiJSON("write a thesis");
  assert.equal(text, '{"thesis":"hi"}');
});

test("missing GEMINI_API_KEY: returns empty string without calling the gateway", async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const text = await callGeminiJSON("write a thesis");
    assert.equal(text, "");
  } finally {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  }
});

test("gateway failure (both chain steps down): rethrows, matching the original throw-on-HTTP-failure contract", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });
  await assert.rejects(() => callGeminiJSON("write a thesis"), /HTTP 500/);
});

test("uses MODEL_SBA_NARRATIVE (GEMINI_PRO) as modelOverride, with thinkingLevel low", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req) => {
    captured = req;
    return okResult('{"ok":true}');
  });
  await callGeminiJSON("write a thesis");
  assert.equal(captured.model, GEMINI_PRO);
  assert.equal(captured.thinkingLevel, "low");
});

test("parseNarrativeField unwraps fenced and prefaced JSON", () => {
  const narrative = "Specific borrower analysis with enough detail to be useful.";
  assert.equal(
    parseNarrativeField(`\`\`\`json\n${JSON.stringify({ executiveSummary: narrative })}\n\`\`\``, "executiveSummary", "fallback"),
    narrative,
  );
  assert.equal(
    parseNarrativeField(`Here is the requested JSON:\n${JSON.stringify({ executiveSummary: narrative })}`, "executiveSummary", "fallback"),
    narrative,
  );
});

test("parseNarrativeField fails closed on malformed serialized output", () => {
  assert.equal(
    parseNarrativeField("```json\n{not valid json}\n```", "executiveSummary", "fallback"),
    "fallback",
  );
});
