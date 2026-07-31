import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { callGeminiForExtraction } =
  require("../geminiClient") as typeof import("../geminiClient");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../../../ai/gateway") as typeof import("../../../../ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

const BASE_ARGS = {
  prompt: {
    systemInstruction: "Extract facts from this tax return.",
    userPrompt: "OCR text of a business tax return.",
    promptVersion: "v1",
    docType: "BUSINESS_TAX_RETURN",
    expectedKeys: ["revenue"],
  },
  documentId: "doc-1",
};

const VALID_JSON = JSON.stringify({
  facts: { revenue: 100000 },
  metadata: { taxYear: 2023 },
});

beforeEach(() => {
  __setProviderImplForTests("openai", async () => {
    throw new Error("openai fallback not configured in this test");
  });
});

after(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

test("happy path (OCR text): threads authMode:vertex, no inlineData", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req: any) => {
    captured = req;
    return okResult(VALID_JSON);
  });

  const result = await callGeminiForExtraction(BASE_ARGS);

  assert.equal(result.ok, true);
  assert.equal(captured.authMode, "vertex");
  assert.equal(captured.inlineData, undefined);
  assert.deepEqual((result.rawJson as any).facts, { revenue: 100000 });
});

test("happy path (native PDF): threads inlineData and mediaResolution through for a Gemini 3.x model", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req: any) => {
    captured = req;
    return okResult(VALID_JSON);
  });

  const result = await callGeminiForExtraction({
    ...BASE_ARGS,
    pdfBase64: "base64pdfdata==",
    mimeType: "application/pdf",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(captured.inlineData, [
    { mimeType: "application/pdf", data: "base64pdfdata==" },
  ]);
  assert.equal(captured.mediaResolution, "MEDIA_RESOLUTION_HIGH");
});

test("empty response with finishReason: retries, then reports empty_response:<finishReason> after exhausting retries", async () => {
  // No pdfBase64 here means no inlineData — the generator chain's openai
  // fallback step IS attempted for real (unlike the PDF path, where it's
  // skipped as a capability mismatch), so both providers must fail
  // identically to simulate "the whole call fails on empty response",
  // matching this session's established multi-provider test convention.
  __setProviderImplForTests("google", async () => {
    throw new Error("empty response (finishReason: MAX_TOKENS)");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("empty response (finishReason: MAX_TOKENS)");
  });
  const result = await callGeminiForExtraction(BASE_ARGS);
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, "empty_response:MAX_TOKENS");
});

test("empty response with no finishReason: reports plain empty_response", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("empty response");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("empty response");
  });
  const result = await callGeminiForExtraction(BASE_ARGS);
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, "empty_response");
});

test("invalid JSON on both attempts: ok:false with invalid_json", async () => {
  __setProviderImplForTests("google", async () => okResult("not json"));
  const result = await callGeminiForExtraction(BASE_ARGS);
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, "invalid_json");
});

test("valid JSON missing the 'facts' key: ok:false with missing_facts_key", async () => {
  __setProviderImplForTests("google", async () => okResult(JSON.stringify({ metadata: {} })));
  const result = await callGeminiForExtraction(BASE_ARGS);
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, "missing_facts_key");
});

test("SDK_HTML_RESPONSE: surfaces with the SDK_HTML_RESPONSE: prefix", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 502: <!DOCTYPE html><html>Bad Gateway</html>");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 502: <!DOCTYPE html><html>Bad Gateway</html>");
  });
  const result = await callGeminiForExtraction(BASE_ARGS);
  assert.equal(result.ok, false);
  assert.match(result.failureReason ?? "", /^SDK_HTML_RESPONSE:/);
});

test("recovers on retry: attempt 1 empty, attempt 2 succeeds", async () => {
  let call = 0;
  __setProviderImplForTests("google", async () => {
    call++;
    if (call === 1) throw new Error("empty response");
    return okResult(VALID_JSON);
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("empty response");
  });
  const result = await callGeminiForExtraction(BASE_ARGS);
  assert.equal(result.ok, true);
  assert.equal(call, 2);
});
