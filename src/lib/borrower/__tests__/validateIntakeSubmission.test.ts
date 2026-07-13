import test from "node:test";
import assert from "node:assert/strict";

import { validateIntakeSubmission, type IntakeSubmissionInputs } from "../validateIntakeSubmission";

function baseInput(overrides: Partial<IntakeSubmissionInputs> = {}): IntakeSubmissionInputs {
  return {
    app: { business_legal_name: "Acme LLC", loan_type: "CRE", loan_amount: 250_000 },
    addressCompleted: true,
    ownerCount: 1,
    isSbaLoanType: false,
    complianceCompleted: false,
    ...overrides,
  };
}

test("a fully complete non-SBA application passes", () => {
  assert.equal(validateIntakeSubmission(baseInput()), null);
});

test("a fully complete SBA application with compliance answered passes", () => {
  assert.equal(
    validateIntakeSubmission(baseInput({ isSbaLoanType: true, complianceCompleted: true })),
    null,
  );
});

test("rejects when there's no application row at all", () => {
  const err = validateIntakeSubmission(baseInput({ app: null }));
  assert.match(err ?? "", /No application found/);
});

test("rejects missing business legal name", () => {
  const err = validateIntakeSubmission(
    baseInput({ app: { business_legal_name: null, loan_type: "CRE", loan_amount: 250_000 } }),
  );
  assert.match(err ?? "", /Business legal name is required/);
});

test("rejects missing loan type", () => {
  const err = validateIntakeSubmission(
    baseInput({ app: { business_legal_name: "Acme LLC", loan_type: null, loan_amount: 250_000 } }),
  );
  assert.match(err ?? "", /select a loan type/);
});

test("rejects missing or zero loan amount", () => {
  const err1 = validateIntakeSubmission(
    baseInput({ app: { business_legal_name: "Acme LLC", loan_type: "CRE", loan_amount: null } }),
  );
  assert.match(err1 ?? "", /loan amount/);

  const err2 = validateIntakeSubmission(
    baseInput({ app: { business_legal_name: "Acme LLC", loan_type: "CRE", loan_amount: 0 } }),
  );
  assert.match(err2 ?? "", /loan amount/);
});

test("rejects an incomplete address step", () => {
  const err = validateIntakeSubmission(baseInput({ addressCompleted: false }));
  assert.match(err ?? "", /business address/);
});

test("rejects zero owners", () => {
  const err = validateIntakeSubmission(baseInput({ ownerCount: 0 }));
  assert.match(err ?? "", /at least one business owner/);
});

test("SBA loan type blocks submission until compliance is answered", () => {
  const err = validateIntakeSubmission(baseInput({ isSbaLoanType: true, complianceCompleted: false }));
  assert.match(err ?? "", /SBA compliance questions/);
});

test("non-SBA loan type never requires compliance", () => {
  assert.equal(
    validateIntakeSubmission(baseInput({ isSbaLoanType: false, complianceCompleted: false })),
    null,
  );
});

test("checks run in a stable order — business name error surfaces before later checks", () => {
  const err = validateIntakeSubmission(
    baseInput({
      app: { business_legal_name: null, loan_type: null, loan_amount: null },
      addressCompleted: false,
      ownerCount: 0,
    }),
  );
  assert.match(err ?? "", /Business legal name is required/);
});
