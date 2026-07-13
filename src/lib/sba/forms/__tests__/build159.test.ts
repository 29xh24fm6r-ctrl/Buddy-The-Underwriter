import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSbaForm159 } from "@/lib/sba/forms/build159";

test("buildSbaForm159 surfaces missing applicant + loan amount instead of defaulting", () => {
  const { fields, missing } = buildSbaForm159({
    dealId: "d1",
    applicantName: null,
    loanAmount: null,
    lenderBankId: null,
    lenderBankName: null,
    feeLedger: [],
  });

  assert.equal(fields.applicant_name, null);
  assert.equal(fields.loan_amount, null);
  assert.ok(missing.includes("applicant_name"));
  assert.ok(missing.includes("loan_amount"));
  assert.ok(missing.includes("fees"));
});

test("buildSbaForm159 always stamps Buddy Brokerage as agent of record", () => {
  const { fields } = buildSbaForm159({
    dealId: "d1",
    applicantName: "Acme LLC",
    loanAmount: 500000,
    lenderBankId: null,
    lenderBankName: null,
    feeLedger: [],
  });

  assert.equal(fields.agent.name, "Buddy Brokerage");
  assert.equal(fields.agent.type, "loan packager");
});

test("buildSbaForm159 itemizes active fees and sums total compensation", () => {
  const { fields, missing } = buildSbaForm159({
    dealId: "d1",
    applicantName: "Acme LLC",
    loanAmount: 500000,
    lenderBankId: "b1",
    lenderBankName: "First National",
    feeLedger: [
      { fee_type: "borrower_packaging", payer_type: "borrower", payee_type: "brokerage", amount_cents: 100000, bps: null, basis_amount_cents: null, status: "disclosed" },
      { fee_type: "lender_referral", payer_type: "lender", payee_type: "brokerage", amount_cents: 5000, bps: 100, basis_amount_cents: 500000, status: "estimated" },
    ],
  });

  assert.equal(fields.fees.length, 2);
  assert.equal(fields.total_compensation_cents, 105000);
  assert.ok(fields.compensation_description?.includes("packaging"));
  assert.ok(fields.compensation_description?.includes("referral"));
  assert.equal(fields.lender.name, "First National");
  assert.ok(!missing.includes("fees"));
});

test("buildSbaForm159 excludes waived/cancelled fees from compensation total", () => {
  const { fields } = buildSbaForm159({
    dealId: "d1",
    applicantName: "Acme LLC",
    loanAmount: 500000,
    lenderBankId: null,
    lenderBankName: null,
    feeLedger: [
      { fee_type: "borrower_packaging", payer_type: "borrower", payee_type: "brokerage", amount_cents: 100000, bps: null, basis_amount_cents: null, status: "waived" },
    ],
  });

  assert.equal(fields.fees.length, 0);
  assert.equal(fields.total_compensation_cents, 0);
});
