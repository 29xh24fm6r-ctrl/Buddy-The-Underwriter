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
const bankerAnalysisRoute = readFileSync("src/app/api/deals/[dealId]/banker-analysis/run/route.ts", "utf8");
const labClient = readFileSync("src/components/brokerage/GoldenTridentLabClient.tsx", "utf8");
const memoPage = readFileSync("src/app/(app)/deals/[dealId]/credit-memo/page.tsx", "utf8");
const narrativeAssembly = readFileSync("src/lib/creditMemo/canonical/narrativeAssembly.ts", "utf8");
const frontierFactory = readFileSync("src/lib/ai/frontierArtifactFactory.ts", "utf8");
const goldenRun = readFileSync("src/lib/brokerage/goldenRun.ts", "utf8");
const launchReadiness = readFileSync("src/app/admin/brokerage/launch-readiness/page.tsx", "utf8");

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
    assert.match(quality, new RegExp(`artifact\\(\\s*\\"${key}\\"`));
  }
  assert.match(lab, /gradeGoldenTrident/);
  assert.match(lab, /Deterministic commissioning scorecard/);
  assert.match(lab, /Lender judgment of writing quality remains a separate UAT step/);
  assert.match(lab, /AI production commissioning/);
  assert.match(quality, /requiredGatePassed/);
  assert.match(quality, /verification_verdict === "pass"/);
});

test("Golden Trident establishes one NPI-safe provider trace for every nested AI call", () => {
  const generator = readFileSync("src/lib/brokerage/trident/generateTridentBundle.ts", "utf8");
  assert.match(generator, /runWithAIExecutionContext/);
  assert.match(generator, /traceId: bundleId/);
  assert.match(generator, /artifactType: "trident_bundle"/);
  assert.match(generator, /npiTagged: true/);
});

test("brokerage staff can run and inspect governed artifacts without changing their active bank", () => {
  assert.match(tridentGenerateRoute, /requireBrokerageStaff\(\)/);
  assert.match(tridentGenerateRoute, /eq\("bank_id", brokerageBankId\)/);
  assert.doesNotMatch(tridentGenerateRoute, /bank_user_memberships/);
  assert.match(spreadRoute, /ensureDealBankAccessAllowingBrokerageStaff/);
  assert.match(memoGenerateRoute, /ensureDealBankAccessAllowingBrokerageStaff/);
  assert.match(memoPage, /ensureDealBankAccessAllowingBrokerageStaff/);
  assert.match(memoPage, /executionContext: "authorized_route"/);
  assert.match(bankerAnalysisRoute, /ensureDealBankAccessAllowingBrokerageStaff/);
  assert.match(labClient, /Run AI assessment/);
});

test("QA fixture commissions canonical spread inputs without seeding a rendered spread", () => {
  assert.match(fixture, /SL_TOTAL_ASSETS/);
  assert.match(fixture, /source_canonical_type/);
  assert.match(fixture, /deal_structural_pricing/);
  assert.match(fixture, /annual_debt_service_est/);
  assert.doesNotMatch(fixture, /\.from\("deal_spreads"\)\.(insert|upsert)/);
});


test("canonical-credit commissioning preserves actionable review evidence and DSCR bases", () => {
  assert.match(frontierFactory, /reviewIssues: remaining/);
  assert.match(memoGenerateRoute, /review_issues: verification\?\.reviewIssues/);
  assert.match(labClient, /formatGenerationFailure/);
  assert.match(labClient, /repairInstruction/);
  assert.match(narrativeAssembly, /debt_service: row\.debt_service/);
  assert.match(narrativeAssembly, /underwriting_reconciliation/);
  assert.match(narrativeAssembly, /cash_flow_available \/ period_debt_service/);
});


test("shadow simulations and legacy rows cannot masquerade as commissioning failures or proof", () => {
  assert.match(goldenRun, /evidenceClass: "synthetic_direct_insert"/);
  assert.match(goldenRun, /commissionsGoldenTrident: false/);
  assert.match(launchReadiness, /post-contract regression\(s\)/);
  assert.match(launchReadiness, /legacy row\(s\) retained for audit/);
});
