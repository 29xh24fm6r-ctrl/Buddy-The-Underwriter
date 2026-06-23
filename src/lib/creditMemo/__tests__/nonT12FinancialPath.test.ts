import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { spreadsForDocType } from "@/lib/financialSpreads/docTypeToSpreadTypes";

/**
 * SPEC-CREDIT-MEMO-NON-T12-FINANCIAL-PATH-INTEGRITY-1
 * SBA / conventional deals must not enqueue, require, read, or cite T12.
 */

const SBA_BUSINESS_DOC_TYPES = [
  "FINANCIAL_STATEMENT", "INCOME_STATEMENT", "OPERATING_STATEMENT",
  "BUSINESS_TAX_RETURN", "TAX_RETURN", "IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS", "K1",
];

describe("no T12 enqueued from SBA/conventional business documents", () => {
  for (const dt of SBA_BUSINESS_DOC_TYPES) {
    it(`${dt} never enqueues T12`, () => {
      const spreads = spreadsForDocType(dt);
      assert.equal(spreads.includes("T12" as any), false, `${dt} must not enqueue T12`);
    });
  }

  it("statements enqueue no spread (annual facts via extraction)", () => {
    for (const dt of ["FINANCIAL_STATEMENT", "INCOME_STATEMENT", "OPERATING_STATEMENT"]) {
      assert.deepEqual(spreadsForDocType(dt), []);
    }
  });

  it("business tax returns route to GLOBAL_CASH_FLOW (repayment), not T12", () => {
    for (const dt of ["BUSINESS_TAX_RETURN", "TAX_RETURN", "IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS", "K1"]) {
      assert.deepEqual(spreadsForDocType(dt), ["GLOBAL_CASH_FLOW"]);
    }
  });

  it("balance-sheet and personal paths are preserved", () => {
    assert.deepEqual(spreadsForDocType("BALANCE_SHEET"), ["BALANCE_SHEET"]);
    assert.deepEqual(spreadsForDocType("PERSONAL_TAX_RETURN"), ["PERSONAL_INCOME", "GLOBAL_CASH_FLOW"]);
    assert.deepEqual(spreadsForDocType("PFS"), ["PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"]);
  });
});

describe("memo T12 NOI fallback is hard-gated to CRE / monthly-statement deals", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts"),
    "utf8",
  );

  it("the T12 NOI proxy is guarded by a CRE/monthly eligibility flag", () => {
    assert.ok(/isMonthlyStatementEligible/.test(src), "must compute a CRE/monthly eligibility gate");
    // The T12 spread read must sit behind the eligibility gate.
    assert.ok(
      /isMonthlyStatementEligible[\s\S]{0,400}spreadType:\s*"T12"/.test(src),
      "the T12 NOI proxy must be gated by isMonthlyStatementEligible",
    );
  });

  it("eligibility derives from rent roll or property collateral (not annual-fact deals)", () => {
    assert.ok(/RENT_ROLL/.test(src) && /property_type/.test(src), "gate uses RENT_ROLL / property_type signals");
  });
});
