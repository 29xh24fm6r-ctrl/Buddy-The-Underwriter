import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../buildCanonicalCreditMemo.ts"),
  "utf8",
);

test("canonical memo construction fails closed on authoritative query errors", () => {
  assert.match(source, /canonical_memo_query_failed:\$\{source\}/);
  assert.match(source, /if \(result\?\.error\)/);
  assert.doesNotMatch(source, /spreadsRes\.error\s*\?\s*\[\]/);

  for (const evidenceSource of [
    "deal_spreads",
    "deal_loan_requests",
    "deal_pricing_quotes",
    "deal_documents",
    "pricing_decisions",
    "ar_aging_reports",
    "borrowing_base_calculations",
    "borrowers",
    "ownership_entities",
    "ai_risk_runs",
    "deal_structural_pricing",
    "period_financial_facts",
    "deal_memo_overrides",
    "qualitative_financial_facts",
    "deal_management_profiles",
    "deal_borrower_story",
    "personal_income_facts",
    "deal_existing_debt_schedule",
    "business_age_facts",
  ]) {
    assert.ok(
      source.includes(`"${evidenceSource}"`),
      `missing canonical memo query proof for ${evidenceSource}`,
    );
  }
});

test("parallel canonical memo result groups are proven before data is consumed", () => {
  const firstProof = source.indexOf('["deal_loan_requests", loanReqResult]');
  const firstUse = source.indexOf("const loanReq = loanReqResult.data");
  assert.ok(firstProof >= 0 && firstProof < firstUse);

  const secondProof = source.indexOf('["borrowers", borrowerResult]');
  const secondUse = source.indexOf("const overrides = (overridesResult");
  assert.ok(secondProof >= 0 && secondProof < secondUse);

  assert.match(
    source,
    /requireCanonicalMemoQuery\("deal_spreads", spreadsRes\);\s*const spreads = spreadsRes\.data \?\? \[\];/s,
  );
});
