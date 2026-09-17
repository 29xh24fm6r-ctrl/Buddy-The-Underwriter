import assert from "node:assert/strict";
import test from "node:test";
import { confirmedLoanTerms } from "../confirmedLoanTerms";
const confirmed = { status: "confirmed", loanImpact: { termMonths: 120, interestRate: 0.105 } };
test("confirmed modeled terms retain their unit and do not promote drafts", () => {
  assert.deepEqual(confirmedLoanTerms(confirmed), { termMonths: 120, ratePct: 10.5 });
  assert.deepEqual(confirmedLoanTerms({ ...confirmed, status: "draft" }), { termMonths: null, ratePct: null });
  assert.deepEqual(confirmedLoanTerms({ status: "confirmed", loanImpact: { termMonths: 0, interestRate: NaN } }), { termMonths: null, ratePct: null });
  assert.equal(confirmedLoanTerms({ ...confirmed, loanImpact: { termMonths: 120, interestRate: 0 } }).ratePct, 0);
});
test("conflicting request or pricing cannot silently produce inconsistent documents", () => {
  assert.throws(() => confirmedLoanTerms({ ...confirmed, requestedTerm: 84 }), /term conflict/);
  assert.throws(() => confirmedLoanTerms({ ...confirmed, pricedRatePct: 9.5 }), /rate conflict/);
  assert.equal(confirmedLoanTerms({ ...confirmed, requestedTerm: 120, pricedRatePct: 10.5 }).termMonths, 120);
});
