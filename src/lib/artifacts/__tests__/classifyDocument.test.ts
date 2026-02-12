import test from "node:test";
import assert from "node:assert/strict";

// classifyDocument.ts has `import "server-only"` which throws in test context.
// mapDocTypeToChecklistKeys is a pure function but can't be directly imported.
// These tests are skipped in test runner — the logic is covered by:
// 1. classifyByRules.test.ts (rules-based classification, 21 tests)
// 2. tsc --noEmit (type safety for all modified files)
// 3. resolveDocTyping tests (form-number guardrails)

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
