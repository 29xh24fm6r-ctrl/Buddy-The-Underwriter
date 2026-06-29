/**
 * SPEC-FINENGINE-KNOWLEDGE-WIRE-2 — 2a capture (pure derivation).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAccountingBasis,
  deriveAccountingBasisFromText,
  inferAccountingBasisFromFacts,
} from "@/lib/financialSpreads/accountingBasis";

describe("Knowledge-wire-2 2a — normalizeAccountingBasis", () => {
  it("maps variants onto the four-value domain; OTHER markers beat a bare cash match", () => {
    assert.equal(normalizeAccountingBasis("cash"), "CASH");
    assert.equal(normalizeAccountingBasis("Cash receipts and disbursements"), "CASH");
    assert.equal(normalizeAccountingBasis("Accrual"), "ACCRUAL");
    assert.equal(normalizeAccountingBasis("hybrid"), "OTHER");
    assert.equal(normalizeAccountingBasis("modified cash basis"), "OTHER");
    assert.equal(normalizeAccountingBasis("income tax basis"), "OTHER");
    assert.equal(normalizeAccountingBasis(""), "UNKNOWN");
    assert.equal(normalizeAccountingBasis(null), "UNKNOWN");
  });
});

describe("Knowledge-wire-2 2a — deriveAccountingBasisFromText (Schedule B / Schedule C method line)", () => {
  it("T-2a-1: cash → CASH, accrual → ACCRUAL, hybrid → OTHER", () => {
    const cash = "Form 1065\nSchedule B Other Information\n1 Accounting method: a ☒ Cash b ☐ Accrual c ☐ Other";
    assert.equal(deriveAccountingBasisFromText(cash).basis, "CASH");

    const accrual = "Form 1120S\nSchedule B\n1 Accounting method: a ☐ Cash b ☒ Accrual c ☐ Other";
    assert.equal(deriveAccountingBasisFromText(accrual).basis, "ACCRUAL");

    const hybrid = "Schedule C\nF Accounting method: (1) ☐ Cash (2) ☐ Accrual (3) ☒ Hybrid";
    assert.equal(deriveAccountingBasisFromText(hybrid).basis, "OTHER");
  });

  it("a GAAP-statement basis note is recognized; no evidence → UNKNOWN", () => {
    assert.equal(deriveAccountingBasisFromText("These statements are prepared on the accrual basis of accounting.").basis, "ACCRUAL");
    assert.equal(deriveAccountingBasisFromText("Prepared on the modified cash basis.").basis, "OTHER");
    assert.equal(deriveAccountingBasisFromText("Form 1120\nU.S. Corporation Income Tax Return\nTaxable income 100,000").basis, "UNKNOWN");
    assert.equal(deriveAccountingBasisFromText("").basis, "UNKNOWN");
  });
});

describe("Knowledge-wire-2 2a — inferAccountingBasisFromFacts (Form 1120 fallback)", () => {
  it("T-2a-2: Schedule-L AR/inventory present → ACCRUAL; absent → UNKNOWN (never CASH)", () => {
    assert.equal(inferAccountingBasisFromFacts([{ fact_key: "INVENTORY", fact_value_num: 50_000 }]), "ACCRUAL");
    assert.equal(inferAccountingBasisFromFacts([{ fact_key: "ACCOUNTS_RECEIVABLE", fact_value_num: 120_000 }]), "ACCRUAL");
    assert.equal(inferAccountingBasisFromFacts([{ fact_key: "SL_AR_GROSS", fact_value_num: 1 }]), "ACCRUAL");
    // No receivables/payables/inventory ⇒ no evidence ⇒ UNKNOWN, never CASH
    assert.equal(inferAccountingBasisFromFacts([{ fact_key: "GROSS_RECEIPTS", fact_value_num: 1_000_000 }]), "UNKNOWN");
    assert.equal(inferAccountingBasisFromFacts([{ fact_key: "INVENTORY", fact_value_num: 0 }]), "UNKNOWN");
    assert.equal(inferAccountingBasisFromFacts([]), "UNKNOWN");
  });
});
