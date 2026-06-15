import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isBusinessStatementFact } from "../businessFactScope";

/** SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #2 — business revenue cannot use personal facts. */

describe("isBusinessStatementFact", () => {
  it("keeps business statement facts (DEAL owner, business/legacy canonical types)", () => {
    assert.equal(isBusinessStatementFact({ owner_type: "DEAL", source_canonical_type: "INCOME_STATEMENT" }), true);
    assert.equal(isBusinessStatementFact({ owner_type: "DEAL", source_canonical_type: "BUSINESS_TAX_RETURN" }), true);
    assert.equal(isBusinessStatementFact({ owner_type: "DEAL", source_canonical_type: "BALANCE_SHEET" }), true);
    assert.equal(isBusinessStatementFact({ owner_type: "DEAL", source_canonical_type: null }), true); // legacy
  });

  it("excludes personal-owner facts", () => {
    assert.equal(isBusinessStatementFact({ owner_type: "PERSONAL", source_canonical_type: "INCOME_STATEMENT" }), false);
  });

  it("excludes personal-return facts even when written under owner_type=DEAL (OmniCare case)", () => {
    assert.equal(isBusinessStatementFact({ owner_type: "DEAL", source_canonical_type: "PERSONAL_TAX_RETURN" }), false);
    assert.equal(isBusinessStatementFact({ owner_type: "DEAL", source_canonical_type: "PERSONAL_FINANCIAL_STATEMENT" }), false);
  });

  it("business revenue must never source from personal TOTAL_INCOME when both exist", () => {
    const facts = [
      { factKey: "TOTAL_INCOME", value: 1_000_000, owner_type: "DEAL", source_canonical_type: "BUSINESS_TAX_RETURN" },
      { factKey: "TOTAL_INCOME", value: 282_742, owner_type: "DEAL", source_canonical_type: "PERSONAL_TAX_RETURN" },
    ];
    const business = facts.filter(isBusinessStatementFact);
    assert.equal(business.length, 1);
    assert.equal(business[0]!.value, 1_000_000); // the business return, never the personal 282,742
  });
});
