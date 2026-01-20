import test from "node:test";
import assert from "node:assert/strict";

import { intakeDeepLinkForMissing } from "@/lib/deepLinks/intakeDeepLinks";

test("intakeDeepLinkForMissing routes cockpit anchors", () => {
  const dealId = "deal-123";
  const dealName = intakeDeepLinkForMissing("deal_name", dealId).href;
  const borrower = intakeDeepLinkForMissing("borrower", dealId).href;
  const intake = intakeDeepLinkForMissing("intake_lifecycle", dealId).href;

  assert.ok(dealName.startsWith(`/deals/${dealId}/cockpit`));
  assert.ok(dealName.includes("#deal-name"));
  assert.ok(borrower.startsWith(`/deals/${dealId}/cockpit`));
  assert.ok(borrower.includes("#borrower-identity"));
  assert.ok(intake.startsWith(`/deals/${dealId}/cockpit`));
  assert.ok(intake.includes("#intake"));
  assert.ok(!dealName.includes("/command"));
  assert.ok(!borrower.includes("/command"));
  assert.ok(!intake.includes("/command"));
});

test("intakeDeepLinkForMissing routes loan terms anchors", () => {
  const dealId = "deal-123";
  const loanAmount = intakeDeepLinkForMissing("loan_amount", dealId).href;
  const loanTerms = intakeDeepLinkForMissing("loan_terms", dealId).href;

  assert.ok(loanAmount.includes(`/deals/${dealId}/loan-terms#loan-request`));
  assert.ok(loanTerms.includes(`/deals/${dealId}/loan-terms#loan-request`));
  assert.ok(!loanAmount.includes("/command"));
  assert.ok(!loanTerms.includes("/command"));
});

test("intakeDeepLinkForMissing defaults to intake cockpit", () => {
  const dealId = "deal-123";
  const fallback = intakeDeepLinkForMissing("unknown_key", dealId).href;

  assert.ok(fallback.startsWith(`/deals/${dealId}/cockpit`));
  assert.ok(fallback.includes("#intake"));
  assert.ok(!fallback.includes("/command"));
});
