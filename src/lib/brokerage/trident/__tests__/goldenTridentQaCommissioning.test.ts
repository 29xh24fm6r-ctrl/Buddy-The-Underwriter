import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fixture = readFileSync("src/lib/brokerage/trident/goldenTridentQaFixture.ts", "utf8");
const route = readFileSync("src/app/api/admin/brokerage/command-center/route.ts", "utf8");
const quality = readFileSync("src/lib/brokerage/trident/goldenTridentQuality.ts", "utf8");
const lab = readFileSync("src/components/brokerage/GoldenTridentLab.tsx", "utf8");
const tridentGenerateRoute = readFileSync("src/app/api/brokerage/deals/[dealId]/trident/generate/route.ts", "utf8");
const spreadRoute = readFileSync("src/app/api/deals/[dealId]/classic-spread/route.ts", "utf8");
const memoGenerateRoute = readFileSync("src/app/api/deals/[dealId]/credit-memo/generate/route.ts", "utf8");

test("QA fixture seeds evidence and underwriting inputs, never fake outputs", () => {
  assert.match(fixture, /SYNTHETIC QA EVIDENCE — NOT A BORROWER DOCUMENT/);
  assert.match(fixture, /\.from\("deal_financial_facts"\)\.insert\(facts\)/);
  assert.match(fixture, /\.from\("buddy_sba_assumptions"\)\.insert/);
  assert.match(fixture, /status: "confirmed"/);
  assert.match(fixture, /is_test: true/);
  assert.match(fixture, /deal_type: "SBA"/);
  assert.match(fixture, /product_type: "SBA_7A"/);
  assert.doesNotMatch(fixture, /deal_type: "SBA_7A"/);
  assert.doesNotMatch(fixture, /\.from\("buddy_trident_bundles"\)\.(insert|upsert)/);
  assert.doesNotMatch(fixture, /\.from\("buddy_sba_packages"\)\.(insert|upsert)/);
  assert.doesNotMatch(fixture, /\.from\("buddy_feasibility_studies"\)\.(insert|upsert)/);
  assert.doesNotMatch(fixture, /\.from\("canonical_memo_narratives"\)\.(insert|upsert)/);
  assert.doesNotMatch(fixture, /\.from\("deal_spreads"\)\.(insert|upsert)/);
});

test("QA fixture is admin-only and bank-scoped", () => {
  assert.match(route, /requireBrokerageStaff\(\)/);
  assert.match(route, /getBrokerageBankId\(\)/);
  assert.match(route, /seedGoldenTridentQaFixture/);
  assert.match(route, /seed_golden_trident_qa/);
});

test("quality lab grades every lender-facing artifact family", () => {
  for (const key of ["businessPlan", "projections", "feasibility", "spreads", "creditMemo"]) {
    assert.match(quality, new RegExp(`artifact\\(\\"${key}\\"`));
  }
  assert.match(lab, /gradeGoldenTrident/);
  assert.match(lab, /Deterministic commissioning scorecard/);
  assert.match(lab, /Lender judgment of writing quality remains a separate UAT step/);
});

test("brokerage staff can run and inspect governed artifacts without changing their active bank", () => {
  assert.match(tridentGenerateRoute, /requireBrokerageStaff\(\)/);
  assert.match(tridentGenerateRoute, /eq\("bank_id", brokerageBankId\)/);
  assert.doesNotMatch(tridentGenerateRoute, /bank_user_memberships/);
  assert.match(spreadRoute, /ensureDealBankAccessAllowingBrokerageStaff/);
  assert.match(memoGenerateRoute, /ensureDealBankAccessAllowingBrokerageStaff/);
});
