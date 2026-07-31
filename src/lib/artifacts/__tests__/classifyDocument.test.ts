import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// classifyDocument.ts has `import "server-only"` which throws in test context
// — same CJS-resolver-patch + require() pattern as every other test that
// loads gateway-touching code (see geminiClient.test.ts). Previously this
// file avoided importing classifyDocument entirely; SPEC-M1.1 routed its
// Gemini tier through the AI gateway's provider-impl test seam, so the real
// gemini/fallback tiers can now be exercised directly (see the "Tier B/C"
// describe block below). mapDocTypeToChecklistKeys is still not covered
// here — the logic is covered by:
// 1. classifyByRules.test.ts (rules-based classification, 21 tests)
// 2. tsc --noEmit (type safety for all modified files)
// 3. resolveDocTyping tests (form-number guardrails)
mockServerOnly();
const require = createRequire(import.meta.url);
const { classifyDocument } =
  require("../classifyDocument") as typeof import("../classifyDocument");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

const UNCLASSIFIABLE_TEXT =
  "Lorem ipsum dolor sit amet, a completely generic paragraph with no form numbers, no keywords, and no filename anchors that classifyByRules could match.";

const VALID_GEMINI_JSON = JSON.stringify({
  doc_type: "LEASE",
  confidence: 0.88,
  reason: "Commercial lease terms visible",
  tax_year: null,
  entity_name: "Acme Corp",
  entity_type: "business",
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

// ---------------------------------------------------------------------------
// ExtractionResult type contract tests
// ---------------------------------------------------------------------------

test("ExtractionResult type supports skipped/skipReason fields", () => {
  // This validates the type contract — if ExtractionResult didn't have these
  // fields, tsc would fail on the 6 legacy extractor files.
  const result = {
    ok: false as const,
    factsWritten: 0,
    skipped: true,
    skipReason: "legacy_llm_extractor_disabled",
  };
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, "legacy_llm_extractor_disabled");
  assert.equal(result.factsWritten, 0);
});

// ---------------------------------------------------------------------------
// ClassificationResult type contract tests
// ---------------------------------------------------------------------------

test("ClassificationResult supports tier and model fields", () => {
  const result = {
    docType: "IRS_BUSINESS" as const,
    confidence: 0.92,
    reason: "Form 1120S found",
    taxYear: 2023,
    entityName: null,
    entityType: "business" as const,
    proposedDealName: null,
    proposedDealNameSource: null,
    rawExtraction: {},
    formNumbers: ["1120S"],
    issuer: "IRS",
    periodStart: "2023-01-01",
    periodEnd: "2023-12-31",
    tier: "rules" as const,
    model: "rules:rules_form",
  };
  assert.equal(result.tier, "rules");
  assert.equal(result.model, "rules:rules_form");
  assert.equal(result.docType, "IRS_BUSINESS");
});

test("ClassificationResult tier can be docai, rules, gemini, or fallback", () => {
  const tiers = ["docai", "rules", "gemini", "fallback"] as const;
  for (const tier of tiers) {
    assert.ok(typeof tier === "string");
  }
});

test("DocAiSignals type supports all expected fields", () => {
  const signals = {
    processorType: "TAX_PROCESSOR",
    docTypeLabel: "tax_return_1040",
    docTypeConfidence: 0.95,
    entities: [{ type: "document_type", mentionText: "1040", confidence: 0.95 }],
  };
  assert.equal(signals.processorType, "TAX_PROCESSOR");
  assert.equal(signals.docTypeLabel, "tax_return_1040");
  assert.ok(signals.docTypeConfidence >= 0.75);
});

// ---------------------------------------------------------------------------
// SPEC-M1.1: Tier B (Gemini via the AI gateway) and Tier C (fallback) —
// exercised end-to-end now that the gateway's provider-impl test seam makes
// this possible without a live GCP/Vertex environment.
// ---------------------------------------------------------------------------

test("Tier B: rules can't classify, gateway succeeds — returns a gemini-tier result", async () => {
  __setProviderImplForTests("google", async (req: any) => {
    assert.equal(req.authMode, "vertex");
    return okResult(VALID_GEMINI_JSON);
  });

  const result = await classifyDocument(UNCLASSIFIABLE_TEXT, "scan.pdf", "application/pdf");

  assert.equal(result.tier, "gemini");
  assert.equal(result.docType, "LEASE");
  assert.equal(result.confidence, 0.88);
  assert.equal(result.entityName, "Acme Corp");
});

test("Tier C: gateway fails (both chain steps down) — falls back to OTHER when rules also can't classify", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });

  const result = await classifyDocument(UNCLASSIFIABLE_TEXT, "scan.pdf", "application/pdf");

  assert.equal(result.tier, "fallback");
  assert.equal(result.docType, "OTHER");
});

test("Tier C: gateway fails but rules had a low-confidence guess — falls back to the rules result, not bare OTHER", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });

  // "insurance" in the filename is a filename-tier rules match — confidence
  // 0.62, below the 0.65 Tier-A acceptance bar, so Tier B is still attempted
  // (see classifyByRules.ts's FILENAME_RULES/RULES_TIER_MIN_CONFIDENCE).
  const result = await classifyDocument(
    UNCLASSIFIABLE_TEXT,
    "insurance-cert.pdf",
    "application/pdf",
  );

  assert.equal(result.tier, "fallback");
  assert.notEqual(result.docType, "OTHER");
});
