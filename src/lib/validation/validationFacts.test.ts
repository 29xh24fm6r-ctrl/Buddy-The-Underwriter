import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeValidationFacts,
  VALIDATION_RULESET_VERSION,
} from "./validationFacts";

test("normalizes current spread facts into deterministic validation keys", () => {
  const facts = normalizeValidationFacts({
    CF_ANNUAL_DEBT_SERVICE: 137_616,
    CF_NCADS: 360_000,
    RATIO_DSCR_FINAL: 2.616,
    TOTAL_EQUITY: 850_000,
    TOTAL_ASSETS: 1_680_000,
    TOTAL_LIABILITIES: 830_000,
  });

  assert.equal(facts.ANNUAL_DEBT_SERVICE, 137_616);
  assert.equal(facts.CASH_FLOW_AVAILABLE, 360_000);
  assert.equal(facts.DSCR, 2.616);
  assert.equal(facts.NET_WORTH, 850_000);
  assert.equal(VALIDATION_RULESET_VERSION, "buddy-validation-v2");
});

test("does not overwrite an explicit canonical fact with an alias", () => {
  const facts = normalizeValidationFacts({
    DSCR: 1.25,
    RATIO_DSCR_FINAL: 2.5,
    NET_WORTH: 900_000,
    TOTAL_EQUITY: 850_000,
  });

  assert.equal(facts.DSCR, 1.25);
  assert.equal(facts.NET_WORTH, 900_000);
});
