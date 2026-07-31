import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { extractStructuredAssist } =
  require("../geminiFlashStructuredAssist") as typeof import("../geminiFlashStructuredAssist");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

const VALID_STRUCTURED_JSON = JSON.stringify({
  entities: [{ type: "ein", mentionText: "12-3456789", confidence: 0.9 }],
  formFields: [{ name: "tax_year", value: "2023", confidence: 0.95 }],
});

const BASE_ARGS = {
  ocrText: "Form 1120S U.S. Income Tax Return for an S Corporation",
  canonicalType: "BUSINESS_TAX_RETURN",
  documentId: "doc-1",
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

test("happy path: threads authMode:vertex through and returns validated entities/formFields", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req: any) => {
    captured = req;
    return okResult(VALID_STRUCTURED_JSON);
  });

  const result = await extractStructuredAssist(BASE_ARGS);

  assert.equal(captured.authMode, "vertex");
  assert.ok(result);
  assert.equal(result?.entities[0].type, "ein");
  assert.equal(result?.formFields[0].name, "tax_year");
  assert.equal(result?._meta.source, "gemini_flash_structured_assist");
});

test("unsupported canonicalType: returns null without calling the gateway", async () => {
  let called = false;
  __setProviderImplForTests("google", async () => {
    called = true;
    return okResult(VALID_STRUCTURED_JSON);
  });
  const result = await extractStructuredAssist({ ...BASE_ARGS, canonicalType: "SOMETHING_UNKNOWN" });
  assert.equal(result, null);
  assert.equal(called, false);
});

test("page-count guard: skips very long documents without calling the gateway", async () => {
  let called = false;
  __setProviderImplForTests("google", async () => {
    called = true;
    return okResult(VALID_STRUCTURED_JSON);
  });
  const result = await extractStructuredAssist({ ...BASE_ARGS, pageCount: 999 });
  assert.equal(result, null);
  assert.equal(called, false);
});

test("empty response on first attempt, valid JSON on retry: succeeds via the inner retry path", async () => {
  let call = 0;
  __setProviderImplForTests("google", async () => {
    call++;
    if (call === 1) return okResult("");
    return okResult(VALID_STRUCTURED_JSON);
  });
  const result = await extractStructuredAssist(BASE_ARGS);
  assert.ok(result);
  assert.equal(call, 2);
});

test("invalid JSON on both attempts: returns null after exhausting the retry budget", async () => {
  __setProviderImplForTests("google", async () => okResult("not json at all"));
  const result = await extractStructuredAssist(BASE_ARGS);
  assert.equal(result, null);
});

test("network/HTTP failure (both chain steps down): exits immediately to the outer catch, returns null", async () => {
  let calls = 0;
  __setProviderImplForTests("google", async () => {
    calls++;
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });
  const result = await extractStructuredAssist(BASE_ARGS);
  assert.equal(result, null);
  // A genuine network/HTTP failure is NOT retried inner-loop-style (unlike
  // empty_response) — it exits to the outer catch after the first attempt.
  assert.equal(calls, 1);
});
