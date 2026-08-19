import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/brokerage/deals/[dealId]/trident/generate/route.ts", "utf8");
const workflow = readFileSync("src/workflows/goldenTrident.ts", "utf8");
const stages = readFileSync("src/lib/brokerage/trident/tridentFactoryStages.ts", "utf8");
const generator = readFileSync("src/lib/brokerage/trident/generateTridentBundle.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260819000000_golden_trident_factory.sql", "utf8");
const client = readFileSync("src/components/brokerage/GoldenTridentLabClient.tsx", "utf8");
const nextConfig = readFileSync("next.config.mjs", "utf8");
const readiness = readFileSync("src/lib/brokerage/trident/tridentReadiness.ts", "utf8");
const fixture = readFileSync("src/lib/brokerage/trident/goldenTridentQaFixture.ts", "utf8");
const memoPdfRoute = readFileSync("src/app/api/deals/[dealId]/credit-memo/canonical/pdf/route.ts", "utf8");
const dealAccess = readFileSync("src/lib/tenant/ensureDealBankAccess.ts", "utf8");
const analysisRoute = readFileSync("src/app/api/deals/[dealId]/banker-analysis/run/route.ts", "utf8");
const validationPass = readFileSync("src/lib/validation/buddyValidationPass.ts", "utf8");
const validationFacts = readFileSync("src/lib/validation/validationFacts.ts", "utf8");
const canonicalMemoBuilder = readFileSync("src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts", "utf8");
const canonicalMemoArtifact = readFileSync("src/lib/creditMemo/canonical/generateCanonicalMemoArtifact.ts", "utf8");
const snapshot = readFileSync("src/lib/brokerage/trident/tridentInputSnapshot.ts", "utf8");
const releaseGate = readFileSync("src/lib/brokerage/trident/tridentReleaseGate.ts", "utf8");

test("final Trident generation is accepted into a multi-stage durable workflow", () => {
  assert.match(route, /start\(goldenTridentWorkflow/);
  assert.match(route, /status:\s*202/);
  assert.doesNotMatch(route, /await generateTridentBundle/);
  assert.match(workflow, /"use workflow"/);
  assert.equal((workflow.match(/"use step"/g) ?? []).length, 5);
  assert.match(workflow, /prepare\(args\)/);
  assert.match(workflow, /canonical\(/);
  assert.match(workflow, /artifacts\(execution\)/);
  assert.match(workflow, /manifest\(execution\)/);
  assert.match(nextConfig, /withWorkflow\(nextConfig\)/);
});

test("admission and stage progress are database-enforced and observable", () => {
  assert.match(generator, /acquire_trident_bundle_run/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /one_active_per_deal_mode/);
  assert.match(migration, /buddy_trident_bundle_stages/);
  assert.match(route, /workflow_run_id/);
  assert.match(route, /current_stage/);
  assert.match(route, /buddy_trident_bundle_stages/);
  assert.match(stages, /input_snapshot/);
  assert.match(stages, /canonical_credit/);
  assert.match(stages, /artifact_factory/);
  assert.match(stages, /release_manifest/);
});

test("the factory creates canonical credit artifacts and preserves failures", () => {
  assert.match(stages, /generateCanonicalMemoArtifact/);
  assert.match(stages, /renderClassicPdfSpread/);
  assert.match(generator, /business_plan_pdf_path: businessPlanPath/);
  assert.match(generator, /projections_xlsx_path: projectionsXlsxPath/);
  assert.match(generator, /feasibility_pdf_path: feasibilityPdfPath/);
  assert.doesNotMatch(generator, /generation_error: msg\.slice/);
  assert.match(client, /router\.refresh\(\)/);
  assert.match(client, /current_stage/);
  assert.match(generator, /verification_flagged_claims/);
  assert.doesNotMatch(generator, /generateCanonicalMemoArtifact/);
  assert.doesNotMatch(generator, /renderClassicPdfSpread/);
  assert.match(generator, /boundSources\.source_credit_memo_id/);
  assert.match(generator, /boundSources\.source_spread_id/);
});

test("production commissioning cannot reuse stale evidence or bypass validation", () => {
  assert.match(fixture, /golden-trident-qa-v4/);
  assert.doesNotMatch(fixture, /golden-trident-qa-v3/);
  assert.match(readiness, /Run the AI assessment and deterministic validation/);
  assert.match(readiness, /else if \(!validationStatus\)/);
});

test("brokerage artifacts use scoped deal tenancy without a false strict mismatch probe", () => {
  assert.match(memoPdfRoute, /ensureDealBankAccessAllowingBrokerageStaff/);
  assert.match(memoPdfRoute, /bankId: access\.bankId/);
  const brokerageGuard = dealAccess.slice(dealAccess.indexOf("export async function ensureDealBankAccessAllowingBrokerageStaff"));
  assert.match(brokerageGuard, /requireBrokerageStaff/);
  assert.ok(
    brokerageGuard.indexOf("requireBrokerageStaff") < brokerageGuard.indexOf("return ensureDealBankAccess"),
    "brokerage authorization must occur before the strict active-bank fallback",
  );
});


test("AI assessment owns deterministic validation and never reports false success", () => {
  assert.match(analysisRoute, /runBuddyValidationPass\(dealId\)/);
  assert.match(analysisRoute, /result, validation/);
  assert.match(client, /body\.result\?\.status !== "succeeded"/);
  assert.match(client, /deterministic validation completed/);
  assert.match(validationPass, /fact_key, fact_value_num/);
  assert.doesNotMatch(validationPass, /fact_key, value_num/);
  assert.match(validationPass, /validation_report_write_failed/);
});


test("deterministic validation recognizes production canonical fact names and invalidates stale verdicts", () => {
  assert.match(validationPass, /normalizeValidationFacts/);
  assert.match(validationPass, /VALIDATION_RULESET_VERSION/);
  assert.match(validationFacts, /CF_ANNUAL_DEBT_SERVICE/);
  assert.match(validationFacts, /CF_NCADS/);
  assert.match(validationFacts, /RATIO_DSCR_FINAL/);
  assert.match(validationFacts, /TOTAL_EQUITY/);
  assert.match(client, /BLOCK_GENERATION/);
  assert.match(client, /blockingChecks/);
});


test("durable canonical-credit workers use an explicit bank-scoped system boundary", () => {
  assert.match(canonicalMemoBuilder, /executionContext\?: "interactive" \| "system"/);
  assert.match(canonicalMemoBuilder, /args\.executionContext !== "system"/);
  assert.match(canonicalMemoBuilder, /\.eq\("bank_id", bankId\)/);
  assert.match(canonicalMemoArtifact, /executionContext: args\.executionContext/);
  assert.equal((stages.match(/executionContext: "system"/g) ?? []).length, 1);
  assert.equal((generator.match(/executionContext: "system"/g) ?? []).length, 0);
});

test("the admitted bank and input snapshot remain immutable through release", () => {
  assert.match(snapshot, /input_snapshot_changed/);
  assert.match(stages, /bankId: string/);
  assert.match(stages, /inputHash: string/);
  assert.match(stages, /assertTridentInputSnapshot/);
  assert.match(generator, /expectedHash: admittedInputHash/);
  assert.match(generator, /\.eq\("bank_id", admittedBankId\)/);
  assert.match(generator, /\.eq\("input_hash", admittedInputHash\)/);
  assert.match(stages, /attempt_count: attemptCount/);
  assert.match(releaseGate, /synthetic_qa_deal_has_no_public_research_grade/);
  assert.match(releaseGate, /memo_research_preliminary_requires_lender_review/);
});
