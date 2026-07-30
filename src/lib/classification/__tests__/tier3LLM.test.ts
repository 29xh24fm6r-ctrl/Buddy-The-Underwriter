import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { runTier3LLM } = require("../tier3LLM") as typeof import("../tier3LLM");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

const DOC = {
  artifactId: "art-1",
  filename: "doc.pdf",
  mimeType: "application/pdf",
  pageCount: 2,
  firstPageText: "some text",
  firstTwoPagesText: "some text across two pages",
  fullText: "some text across two pages",
  detectedYears: [],
  hasTableLikeStructure: false,
};

const VALID_JSON = JSON.stringify({
  doc_type: "COMMERCIAL_LEASE",
  confidence: 0.9,
  reasoning: "Landlord/Tenant parties and rent schedule visible",
  anchor_evidence: ["rent schedule"],
  confusion_candidates: [],
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

test("happy path: threads authMode:vertex through and returns a matched result", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req: any) => {
    captured = req;
    return okResult(VALID_JSON);
  });

  const result = await runTier3LLM(DOC);

  assert.equal(captured.authMode, "vertex");
  assert.equal(result.matched, true);
  assert.equal(result.docType, "COMMERCIAL_LEASE");
  assert.equal(result.confidence, 0.9);
});

test("T12 prohibition: a T12 doc_type from the model is coerced to INCOME_STATEMENT", async () => {
  __setProviderImplForTests(
    "google",
    async () =>
      okResult(
        JSON.stringify({ doc_type: "T12", confidence: 0.8, reasoning: "looks like a P&L" }),
      ),
  );
  const result = await runTier3LLM(DOC);
  assert.equal(result.docType, "INCOME_STATEMENT");
});

test("non-canonical doc_type is rejected — returns OTHER with matched:false", async () => {
  __setProviderImplForTests(
    "google",
    async () =>
      okResult(JSON.stringify({ doc_type: "HALLUCINATED_TYPE", confidence: 0.9 })),
  );
  const result = await runTier3LLM(DOC);
  assert.equal(result.matched, false);
  assert.equal(result.docType, "OTHER");
  assert.match(result.reason, /non-canonical doc_type/);
});

test("gateway failure (both chain steps down): returns OTHER with matched:false, never throws", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });
  const result = await runTier3LLM(DOC);
  assert.equal(result.matched, false);
  assert.equal(result.docType, "OTHER");
  assert.match(result.reason, /Tier 3 LLM failed/);
});
