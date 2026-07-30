import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { classifyWithGeminiText, classifyWithGeminiVision } =
  require("../geminiClassifier") as typeof import("../geminiClassifier");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

const VALID_JSON = JSON.stringify({
  doc_type: "TAX_RETURN_1040",
  confidence: 0.9,
  tax_year: 2023,
  reasons: ["form 1040 header detected"],
  detected_signals: { form_numbers: ["1040"], has_ein: false, has_ssn: true },
});

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

test("classifyWithGeminiText: happy path returns a parsed classification", async () => {
  __setProviderImplForTests("google", async () => okResult(VALID_JSON));
  const result = await classifyWithGeminiText("some OCR text");
  assert.ok(result);
  assert.equal(result?.doc_type, "TAX_RETURN_1040");
});

test("classifyWithGeminiText: missing GEMINI_API_KEY returns null without calling the gateway", async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const result = await classifyWithGeminiText("some OCR text");
    assert.equal(result, null);
  } finally {
    if (original !== undefined) process.env.GEMINI_API_KEY = original;
  }
});

test("classifyWithGeminiText: gateway failure (both chain steps down) returns null, not a throw", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });
  const result = await classifyWithGeminiText("some OCR text");
  assert.equal(result, null);
});

test("classifyWithGeminiText: unparseable model output returns null", async () => {
  __setProviderImplForTests("google", async () => okResult("not json"));
  const result = await classifyWithGeminiText("some OCR text");
  assert.equal(result, null);
});

test("classifyWithGeminiVision: happy path threads inlineData through and returns a parsed classification", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req) => {
    captured = req;
    return okResult(VALID_JSON);
  });
  const result = await classifyWithGeminiVision("base64data==", "image/png");
  assert.ok(result);
  assert.equal(result?.doc_type, "TAX_RETURN_1040");
  assert.deepEqual(captured.inlineData, [{ mimeType: "image/png", data: "base64data==" }]);
});

test("classifyWithGeminiVision: gateway failure returns null, not a throw", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  const result = await classifyWithGeminiVision("base64data==", "image/png");
  assert.equal(result, null);
});
