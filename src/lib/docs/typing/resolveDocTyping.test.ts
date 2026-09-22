import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDocTyping } from "./resolveDocTyping";

test("canonical borrower 1040 confirmation receives its year-specific checklist key", () => {
  const result = resolveDocTyping({
    aiDocType: "PERSONAL_TAX_RETURN",
    aiFormNumbers: ["1040"],
    aiConfidence: 1,
    aiTaxYear: 2025,
    aiEntityType: "personal",
  });

  assert.equal(result.guardrail_applied, false);
  assert.equal(result.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(result.checklist_key, "IRS_PERSONAL_2025");
});

test("canonical business return receives its year-specific checklist key", () => {
  const result = resolveDocTyping({
    aiDocType: "BUSINESS_TAX_RETURN",
    aiFormNumbers: ["1120S"],
    aiConfidence: 1,
    aiTaxYear: 2024,
    aiEntityType: "business",
  });

  assert.equal(result.guardrail_applied, false);
  assert.equal(result.checklist_key, "IRS_BUSINESS_2024");
});

test("financial statement checklist key includes the borrower-confirmed period", () => {
  const result = resolveDocTyping({
    aiDocType: "BALANCE_SHEET",
    aiFormNumbers: null,
    aiConfidence: 1,
    aiTaxYear: null,
    aiStatementPeriod: "CURRENT",
    aiEntityType: "business",
  });

  assert.equal(result.checklist_key, "FIN_STMT_BS_CURRENT");
});
