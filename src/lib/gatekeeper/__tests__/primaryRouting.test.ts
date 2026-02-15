import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapGatekeeperDocTypeToEffectiveDocType,
} from "../routing";
import type { GatekeeperDocType } from "../types";

// ---------------------------------------------------------------------------
// EXTRACT_ELIGIBLE_DOC_TYPES (mirrored from processArtifact.ts for test assertions)
// ---------------------------------------------------------------------------
const EXTRACT_ELIGIBLE_DOC_TYPES = new Set([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "RENT_ROLL",
  "PERSONAL_FINANCIAL_STATEMENT",
  "PERSONAL_INCOME",
  "SCHEDULE_K1",
  "FINANCIAL_STATEMENT",
]);

function isExtractEligible(docType: string): boolean {
  return EXTRACT_ELIGIBLE_DOC_TYPES.has(docType.toUpperCase().trim());
}

// ---------------------------------------------------------------------------
// mapGatekeeperDocTypeToEffectiveDocType — pure mapping
// ---------------------------------------------------------------------------

describe("mapGatekeeperDocTypeToEffectiveDocType", () => {
  it("maps BUSINESS_TAX_RETURN to BUSINESS_TAX_RETURN", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("BUSINESS_TAX_RETURN"),
      "BUSINESS_TAX_RETURN",
    );
  });

  it("maps PERSONAL_TAX_RETURN to PERSONAL_TAX_RETURN", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("PERSONAL_TAX_RETURN"),
      "PERSONAL_TAX_RETURN",
    );
  });

  it("maps W2 to PERSONAL_TAX_RETURN", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("W2"),
      "PERSONAL_TAX_RETURN",
    );
  });

  it("maps FORM_1099 to PERSONAL_TAX_RETURN", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("FORM_1099"),
      "PERSONAL_TAX_RETURN",
    );
  });

  it("maps K1 to PERSONAL_TAX_RETURN", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("K1"),
      "PERSONAL_TAX_RETURN",
    );
  });

  it("maps BANK_STATEMENT to BANK_STATEMENT", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("BANK_STATEMENT"),
      "BANK_STATEMENT",
    );
  });

  it("maps FINANCIAL_STATEMENT to FINANCIAL_STATEMENT", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("FINANCIAL_STATEMENT"),
      "FINANCIAL_STATEMENT",
    );
  });

  it("maps DRIVERS_LICENSE to ENTITY_DOCS", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("DRIVERS_LICENSE"),
      "ENTITY_DOCS",
    );
  });

  it("maps VOIDED_CHECK to OTHER", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("VOIDED_CHECK"),
      "OTHER",
    );
  });

  it("maps OTHER to OTHER", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("OTHER"),
      "OTHER",
    );
  });

  it("maps UNKNOWN to OTHER", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("UNKNOWN"),
      "OTHER",
    );
  });

  // Defensive: unrecognized type → OTHER
  it("maps unrecognized type to OTHER (defensive fallback)", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("FUTURE_TYPE" as GatekeeperDocType),
      "OTHER",
    );
  });
});

// ---------------------------------------------------------------------------
// Extraction eligibility alignment
// ---------------------------------------------------------------------------

describe("mapGatekeeperDocTypeToEffectiveDocType — extraction eligibility", () => {
  it("BUSINESS_TAX_RETURN is extract-eligible", () => {
    assert.ok(isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("BUSINESS_TAX_RETURN"),
    ));
  });

  it("PERSONAL_TAX_RETURN is extract-eligible", () => {
    assert.ok(isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("PERSONAL_TAX_RETURN"),
    ));
  });

  it("W2 maps to extract-eligible type", () => {
    assert.ok(isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("W2"),
    ));
  });

  it("FORM_1099 maps to extract-eligible type", () => {
    assert.ok(isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("FORM_1099"),
    ));
  });

  it("K1 maps to extract-eligible type", () => {
    assert.ok(isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("K1"),
    ));
  });

  it("FINANCIAL_STATEMENT maps to extract-eligible type", () => {
    assert.ok(isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("FINANCIAL_STATEMENT"),
    ));
  });

  it("BANK_STATEMENT is NOT extract-eligible", () => {
    assert.ok(!isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("BANK_STATEMENT"),
    ));
  });

  it("DRIVERS_LICENSE is NOT extract-eligible", () => {
    assert.ok(!isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("DRIVERS_LICENSE"),
    ));
  });

  it("VOIDED_CHECK is NOT extract-eligible", () => {
    assert.ok(!isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("VOIDED_CHECK"),
    ));
  });

  it("OTHER is NOT extract-eligible", () => {
    assert.ok(!isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("OTHER"),
    ));
  });

  it("UNKNOWN is NOT extract-eligible", () => {
    assert.ok(!isExtractEligible(
      mapGatekeeperDocTypeToEffectiveDocType("UNKNOWN"),
    ));
  });
});

// ---------------------------------------------------------------------------
// All 11 types produce valid output
// ---------------------------------------------------------------------------

describe("mapGatekeeperDocTypeToEffectiveDocType — completeness", () => {
  it("all 11 GatekeeperDocType values return a non-empty string", () => {
    const allTypes: GatekeeperDocType[] = [
      "BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN", "W2", "FORM_1099", "K1",
      "BANK_STATEMENT", "FINANCIAL_STATEMENT", "DRIVERS_LICENSE", "VOIDED_CHECK",
      "OTHER", "UNKNOWN",
    ];

    for (const dt of allTypes) {
      const result = mapGatekeeperDocTypeToEffectiveDocType(dt);
      assert.ok(result.length > 0, `Empty result for ${dt}`);
    }
  });
});
