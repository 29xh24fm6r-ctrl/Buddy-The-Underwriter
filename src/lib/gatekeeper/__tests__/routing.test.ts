import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeGatekeeperRoute, mapGatekeeperToCanonicalHint } from "../routing";
import type { GatekeeperDocType } from "../types";

// ---------------------------------------------------------------------------
// computeGatekeeperRoute
// ---------------------------------------------------------------------------

describe("computeGatekeeperRoute", () => {
  // Rule 1: UNKNOWN → NEEDS_REVIEW
  it("routes UNKNOWN to NEEDS_REVIEW regardless of confidence", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "UNKNOWN", confidence: 0.99, tax_year: null }),
      "NEEDS_REVIEW",
    );
  });

  // Rule 2: Low confidence
  it("routes confidence < 0.80 to NEEDS_REVIEW", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "BUSINESS_TAX_RETURN", confidence: 0.79, tax_year: 2024 }),
      "NEEDS_REVIEW",
    );
  });

  it("routes confidence exactly 0.80 to GOOGLE_DOC_AI_CORE for core type", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "BUSINESS_TAX_RETURN", confidence: 0.80, tax_year: 2024 }),
      "GOOGLE_DOC_AI_CORE",
    );
  });

  it("routes confidence 0.01 below threshold to NEEDS_REVIEW", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "K1", confidence: 0.799, tax_year: 2023 }),
      "NEEDS_REVIEW",
    );
  });

  // Rule 3: Tax return without year
  it("routes BUSINESS_TAX_RETURN with null tax_year to NEEDS_REVIEW", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "BUSINESS_TAX_RETURN", confidence: 0.95, tax_year: null }),
      "NEEDS_REVIEW",
    );
  });

  it("routes PERSONAL_TAX_RETURN with null tax_year to NEEDS_REVIEW", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "PERSONAL_TAX_RETURN", confidence: 0.95, tax_year: null }),
      "NEEDS_REVIEW",
    );
  });

  it("routes BUSINESS_TAX_RETURN with tax_year to GOOGLE_DOC_AI_CORE", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "BUSINESS_TAX_RETURN", confidence: 0.95, tax_year: 2024 }),
      "GOOGLE_DOC_AI_CORE",
    );
  });

  it("routes PERSONAL_TAX_RETURN with tax_year to GOOGLE_DOC_AI_CORE", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "PERSONAL_TAX_RETURN", confidence: 0.90, tax_year: 2023 }),
      "GOOGLE_DOC_AI_CORE",
    );
  });

  // Rule 4: CORE types
  it("routes W2 to GOOGLE_DOC_AI_CORE", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "W2", confidence: 0.95, tax_year: 2024 }),
      "GOOGLE_DOC_AI_CORE",
    );
  });

  it("routes FORM_1099 to GOOGLE_DOC_AI_CORE", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "FORM_1099", confidence: 0.88, tax_year: 2023 }),
      "GOOGLE_DOC_AI_CORE",
    );
  });

  it("routes K1 to GOOGLE_DOC_AI_CORE", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "K1", confidence: 0.92, tax_year: 2024 }),
      "GOOGLE_DOC_AI_CORE",
    );
  });

  // Rule 5: Non-core → STANDARD
  it("routes BANK_STATEMENT to STANDARD", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "BANK_STATEMENT", confidence: 0.95, tax_year: null }),
      "STANDARD",
    );
  });

  it("routes FINANCIAL_STATEMENT to STANDARD", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "FINANCIAL_STATEMENT", confidence: 0.90, tax_year: null }),
      "STANDARD",
    );
  });

  it("routes DRIVERS_LICENSE to STANDARD", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "DRIVERS_LICENSE", confidence: 0.85, tax_year: null }),
      "STANDARD",
    );
  });

  it("routes VOIDED_CHECK to STANDARD", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "VOIDED_CHECK", confidence: 0.99, tax_year: null }),
      "STANDARD",
    );
  });

  it("routes OTHER to STANDARD when confidence is high", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "OTHER", confidence: 0.85, tax_year: null }),
      "STANDARD",
    );
  });

  // Priority: UNKNOWN overrides high confidence
  it("UNKNOWN overrides even 1.0 confidence", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "UNKNOWN", confidence: 1.0, tax_year: 2024 }),
      "NEEDS_REVIEW",
    );
  });

  // W2/K1/1099 do NOT require tax_year (rule 3 only applies to TAX_RETURN types)
  it("W2 with null tax_year still routes to GOOGLE_DOC_AI_CORE", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "W2", confidence: 0.95, tax_year: null }),
      "GOOGLE_DOC_AI_CORE",
    );
  });

  it("K1 with null tax_year still routes to GOOGLE_DOC_AI_CORE", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "K1", confidence: 0.90, tax_year: null }),
      "GOOGLE_DOC_AI_CORE",
    );
  });
});

// ---------------------------------------------------------------------------
// mapGatekeeperToCanonicalHint
// ---------------------------------------------------------------------------

describe("mapGatekeeperToCanonicalHint", () => {
  it("maps BUSINESS_TAX_RETURN to DOC_AI_ATOMIC", () => {
    const hint = mapGatekeeperToCanonicalHint("BUSINESS_TAX_RETURN");
    assert.equal(hint.canonical_type_hint, "BUSINESS_TAX_RETURN");
    assert.equal(hint.routing_class_hint, "DOC_AI_ATOMIC");
  });

  it("maps PERSONAL_TAX_RETURN to DOC_AI_ATOMIC", () => {
    const hint = mapGatekeeperToCanonicalHint("PERSONAL_TAX_RETURN");
    assert.equal(hint.canonical_type_hint, "PERSONAL_TAX_RETURN");
    assert.equal(hint.routing_class_hint, "DOC_AI_ATOMIC");
  });

  it("maps W2 to PERSONAL_TAX_RETURN + DOC_AI_ATOMIC", () => {
    const hint = mapGatekeeperToCanonicalHint("W2");
    assert.equal(hint.canonical_type_hint, "PERSONAL_TAX_RETURN");
    assert.equal(hint.routing_class_hint, "DOC_AI_ATOMIC");
  });

  it("maps FORM_1099 to PERSONAL_TAX_RETURN + DOC_AI_ATOMIC", () => {
    const hint = mapGatekeeperToCanonicalHint("FORM_1099");
    assert.equal(hint.canonical_type_hint, "PERSONAL_TAX_RETURN");
    assert.equal(hint.routing_class_hint, "DOC_AI_ATOMIC");
  });

  it("maps K1 to PERSONAL_TAX_RETURN + DOC_AI_ATOMIC", () => {
    const hint = mapGatekeeperToCanonicalHint("K1");
    assert.equal(hint.canonical_type_hint, "PERSONAL_TAX_RETURN");
    assert.equal(hint.routing_class_hint, "DOC_AI_ATOMIC");
  });

  it("maps BANK_STATEMENT to GEMINI_STANDARD", () => {
    const hint = mapGatekeeperToCanonicalHint("BANK_STATEMENT");
    assert.equal(hint.canonical_type_hint, "BANK_STATEMENT");
    assert.equal(hint.routing_class_hint, "GEMINI_STANDARD");
  });

  it("maps FINANCIAL_STATEMENT to GEMINI_PACKET", () => {
    const hint = mapGatekeeperToCanonicalHint("FINANCIAL_STATEMENT");
    assert.equal(hint.canonical_type_hint, "FINANCIAL_STATEMENT");
    assert.equal(hint.routing_class_hint, "GEMINI_PACKET");
  });

  it("maps DRIVERS_LICENSE to ENTITY_DOCS + GEMINI_STANDARD", () => {
    const hint = mapGatekeeperToCanonicalHint("DRIVERS_LICENSE");
    assert.equal(hint.canonical_type_hint, "ENTITY_DOCS");
    assert.equal(hint.routing_class_hint, "GEMINI_STANDARD");
  });

  it("maps VOIDED_CHECK to OTHER + GEMINI_STANDARD", () => {
    const hint = mapGatekeeperToCanonicalHint("VOIDED_CHECK");
    assert.equal(hint.canonical_type_hint, "OTHER");
    assert.equal(hint.routing_class_hint, "GEMINI_STANDARD");
  });

  it("maps OTHER to OTHER + GEMINI_STANDARD", () => {
    const hint = mapGatekeeperToCanonicalHint("OTHER");
    assert.equal(hint.canonical_type_hint, "OTHER");
    assert.equal(hint.routing_class_hint, "GEMINI_STANDARD");
  });

  it("maps UNKNOWN to OTHER + GEMINI_STANDARD", () => {
    const hint = mapGatekeeperToCanonicalHint("UNKNOWN");
    assert.equal(hint.canonical_type_hint, "OTHER");
    assert.equal(hint.routing_class_hint, "GEMINI_STANDARD");
  });

  // All 11 doc types should return valid hints
  it("returns valid hints for all 11 GatekeeperDocType values", () => {
    const allTypes: GatekeeperDocType[] = [
      "BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN", "W2", "FORM_1099", "K1",
      "BANK_STATEMENT", "FINANCIAL_STATEMENT", "DRIVERS_LICENSE", "VOIDED_CHECK",
      "OTHER", "UNKNOWN",
    ];

    for (const dt of allTypes) {
      const hint = mapGatekeeperToCanonicalHint(dt);
      assert.ok(hint.canonical_type_hint, `Missing canonical_type_hint for ${dt}`);
      assert.ok(hint.routing_class_hint, `Missing routing_class_hint for ${dt}`);
    }
  });
});
