import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeShadowRoutingComparison } from "../shadowRouting";

describe("computeShadowRoutingComparison", () => {
  // ── Doc type divergence ─────────────────────────────────────────────────

  it("matching doc types → divergentDocType=false", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-1",
      slotDocType: "BUSINESS_TAX_RETURN",
      effectiveDocType: "BUSINESS_TAX_RETURN",
      gatekeeperDocType: "BUSINESS_TAX_RETURN",
      gatekeeperRoute: "GOOGLE_DOC_AI_CORE",
      gatekeeperConfidence: 0.95,
    });
    assert.equal(result.divergentDocType, false);
  });

  it("diverging doc types → divergentDocType=true with reason", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-2",
      slotDocType: "PERSONAL_TAX_RETURN",
      effectiveDocType: "PERSONAL_TAX_RETURN",
      gatekeeperDocType: "BANK_STATEMENT",
      gatekeeperRoute: "STANDARD",
      gatekeeperConfidence: 0.88,
    });
    assert.equal(result.divergentDocType, true);
    assert.ok(result.reason?.includes("doc_type:"));
  });

  it("null slotDocType → divergentDocType=false (can't compare)", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-3",
      slotDocType: null,
      effectiveDocType: "BANK_STATEMENT",
      gatekeeperDocType: "BANK_STATEMENT",
      gatekeeperRoute: "STANDARD",
      gatekeeperConfidence: 0.90,
    });
    assert.equal(result.divergentDocType, false);
  });

  it("null gatekeeperDocType → divergentDocType=false", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-4",
      slotDocType: "BUSINESS_TAX_RETURN",
      effectiveDocType: "BUSINESS_TAX_RETURN",
      gatekeeperDocType: null,
      gatekeeperRoute: null,
      gatekeeperConfidence: null,
    });
    assert.equal(result.divergentDocType, false);
  });

  // ── Engine divergence ───────────────────────────────────────────────────

  it("matching engines → divergentEngine=false", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-5",
      slotDocType: "BUSINESS_TAX_RETURN",
      effectiveDocType: "BUSINESS_TAX_RETURN",
      gatekeeperDocType: "BUSINESS_TAX_RETURN",
      gatekeeperRoute: "GOOGLE_DOC_AI_CORE",
      gatekeeperConfidence: 0.95,
    });
    assert.equal(result.slotEngine, "DocAI");
    assert.equal(result.gatekeeperEngine, "DocAI");
    assert.equal(result.divergentEngine, false);
  });

  it("diverging engines (slot=DocAI, gk=Gemini) → divergentEngine=true", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-6",
      slotDocType: "BUSINESS_TAX_RETURN",
      effectiveDocType: "BUSINESS_TAX_RETURN",
      gatekeeperDocType: "FINANCIAL_STATEMENT",
      gatekeeperRoute: "STANDARD",
      gatekeeperConfidence: 0.88,
    });
    assert.equal(result.slotEngine, "DocAI");
    assert.equal(result.gatekeeperEngine, "Gemini");
    assert.equal(result.divergentEngine, true);
    assert.ok(result.reason?.includes("engine:"));
  });

  it("NEEDS_REVIEW → gatekeeperEngine='none' → divergentEngine=false", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-7",
      slotDocType: "BUSINESS_TAX_RETURN",
      effectiveDocType: "BUSINESS_TAX_RETURN",
      gatekeeperDocType: "UNKNOWN",
      gatekeeperRoute: "NEEDS_REVIEW",
      gatekeeperConfidence: 0.30,
    });
    assert.equal(result.gatekeeperEngine, "none");
    assert.equal(result.divergentEngine, false);
  });

  // ── Engine mapping correctness ──────────────────────────────────────────

  it("tax return slot → DocAI engine", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-8",
      slotDocType: "PERSONAL_TAX_RETURN",
      effectiveDocType: "PERSONAL_TAX_RETURN",
      gatekeeperDocType: "PERSONAL_TAX_RETURN",
      gatekeeperRoute: "GOOGLE_DOC_AI_CORE",
      gatekeeperConfidence: 0.95,
    });
    assert.equal(result.slotEngine, "DocAI");
  });

  it("bank statement slot → Gemini engine", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-9",
      slotDocType: "BANK_STATEMENT",
      effectiveDocType: "BANK_STATEMENT",
      gatekeeperDocType: "BANK_STATEMENT",
      gatekeeperRoute: "STANDARD",
      gatekeeperConfidence: 0.92,
    });
    assert.equal(result.slotEngine, "Gemini");
    assert.equal(result.gatekeeperEngine, "Gemini");
  });

  it("both divergent → reason contains both", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-10",
      slotDocType: "PERSONAL_TAX_RETURN",
      effectiveDocType: "PERSONAL_TAX_RETURN",
      gatekeeperDocType: "BANK_STATEMENT",
      gatekeeperRoute: "STANDARD",
      gatekeeperConfidence: 0.90,
    });
    assert.equal(result.divergentDocType, true);
    assert.equal(result.divergentEngine, true);
    assert.ok(result.reason?.includes("doc_type:"));
    assert.ok(result.reason?.includes("engine:"));
  });

  it("no divergence → reason is null", () => {
    const result = computeShadowRoutingComparison({
      documentId: "doc-11",
      slotDocType: "BANK_STATEMENT",
      effectiveDocType: "BANK_STATEMENT",
      gatekeeperDocType: "BANK_STATEMENT",
      gatekeeperRoute: "STANDARD",
      gatekeeperConfidence: 0.95,
    });
    assert.equal(result.reason, null);
  });
});
