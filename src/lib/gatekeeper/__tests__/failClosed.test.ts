import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeGatekeeperRoute } from "../routing";
import type { GatekeeperDocType } from "../types";

describe("computeGatekeeperRoute — fail-closed guarantees", () => {
  it("UNKNOWN → NEEDS_REVIEW regardless of confidence", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "UNKNOWN", confidence: 0.99, tax_year: null }),
      "NEEDS_REVIEW",
    );
  });

  it("confidence < 0.80 → NEEDS_REVIEW", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "BUSINESS_TAX_RETURN", confidence: 0.79, tax_year: 2024 }),
      "NEEDS_REVIEW",
    );
  });

  it("tax return + null year → NEEDS_REVIEW", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "PERSONAL_TAX_RETURN", confidence: 0.95, tax_year: null }),
      "NEEDS_REVIEW",
    );
  });

  it("STANDARD_ELIGIBLE type with high confidence → STANDARD", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "BANK_STATEMENT", confidence: 0.95, tax_year: null }),
      "STANDARD",
    );
  });

  it("unrecognized type (cast) → NEEDS_REVIEW (defensive fallback)", () => {
    // Force a value not in any set to test the defensive Rule 6
    assert.equal(
      computeGatekeeperRoute({
        doc_type: "SOME_FUTURE_TYPE" as GatekeeperDocType,
        confidence: 0.99,
        tax_year: null,
      }),
      "NEEDS_REVIEW",
    );
  });

  it("CORE type with confidence >= 0.80 → GOOGLE_DOC_AI_CORE", () => {
    assert.equal(
      computeGatekeeperRoute({ doc_type: "K1", confidence: 0.80, tax_year: 2024 }),
      "GOOGLE_DOC_AI_CORE",
    );
  });

  it("every STANDARD_ELIGIBLE type routes correctly", () => {
    const standardTypes: GatekeeperDocType[] = [
      "BANK_STATEMENT", "FINANCIAL_STATEMENT", "DRIVERS_LICENSE", "VOIDED_CHECK", "OTHER",
    ];
    for (const dt of standardTypes) {
      assert.equal(
        computeGatekeeperRoute({ doc_type: dt, confidence: 0.95, tax_year: null }),
        "STANDARD",
        `Expected STANDARD for ${dt}`,
      );
    }
  });

  it("every CORE type routes correctly", () => {
    const coreTypes: GatekeeperDocType[] = [
      "BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN", "W2", "FORM_1099", "K1",
    ];
    for (const dt of coreTypes) {
      // Tax returns need a year, others don't
      const needsYear = dt === "BUSINESS_TAX_RETURN" || dt === "PERSONAL_TAX_RETURN";
      assert.equal(
        computeGatekeeperRoute({ doc_type: dt, confidence: 0.95, tax_year: needsYear ? 2024 : null }),
        "GOOGLE_DOC_AI_CORE",
        `Expected GOOGLE_DOC_AI_CORE for ${dt}`,
      );
    }
  });
});
