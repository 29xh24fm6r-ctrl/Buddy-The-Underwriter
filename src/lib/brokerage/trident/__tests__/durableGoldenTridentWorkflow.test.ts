import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/brokerage/deals/[dealId]/trident/generate/route.ts", "utf8");
const workflow = readFileSync("src/workflows/goldenTrident.ts", "utf8");
const stages = readFileSync("src/lib/brokerage/trident/tridentFactoryStages.ts", "utf8");
const generator = readFileSync("src/lib/brokerage/trident/generateTridentBundle.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260819000000_golden_trident_factory.sql", "utf8") +
  readFileSync("supabase/migrations/20260820230000_golden_trident_atomic_factory.sql", "utf8");
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
const completionMigration = readFileSync(
  "supabase/migrations/20260821190000_golden_trident_completion_factory.sql",
  "utf8",
);
const feasibilityEngine = readFileSync("src/lib/feasibility/feasibilityEngine.ts", "utf8");
const certificationMigration = readFileSync(
  "supabase/migrations/20260824192823_golden_trident_e2e_certification_factory.sql",
  "utf8",
);
const runtimeMigration = readFileSync(
  "supabase/migrations/20260824161948_golden_trident_runtime_certification.sql",
  "utf8",
);
const lockJanitor = readFileSync("src/app/api/workers/lock-janitor/route.ts", "utf8");
const reconciliationRepairMigration = readFileSync(
  "supabase/migrations/20260824170400_fix_trident_reconciliation_ambiguity.sql",
  "utf8",
);
const terminalLeaseRepairMigration = readFileSync(
  "supabase/migrations/20260824180300_clear_reconciled_trident_lease_token.sql",
  "utf8",
);
const terminalStageConvergenceMigration = readFileSync(
  "supabase/migrations/20260824200548_golden_trident_terminal_stage_convergence.sql",
  "utf8",
);
const marketplaceCronRoute = readFileSync(
  "src/app/api/cron/brokerage/marketplace/run/route.ts",
  "utf8",
);

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
  assert.match(generator, /createTridentBundleRun/);
  assert.equal((stages.match(/generateCanonicalMemoArtifact\(/g) ?? []).length, 1);
  assert.equal((stages.match(/renderClassicPdfSpread\(/g) ?? []).length, 1);
  assert.match(generator, /boundSources\.source_credit_memo_id/);
  assert.match(generator, /boundSources\.source_spread_id/);
});

test("production commissioning cannot reuse stale evidence or bypass validation", () => {
  assert.match(fixture, /golden-trident-qa-v6/);
  assert.match(fixture, /commission_golden_trident_qa_research/);
  assert.match(completionMigration, /'market_demand'/);
  assert.match(completionMigration, /'complete'/);
  assert.match(completionMigration, /'growth_trajectory'/);
  assert.match(completionMigration, /cardinality\(input_fact_ids\) > 0/);
  assert.match(completionMigration, /jsonb_build_array/);
  assert.match(readiness, /Run the AI assessment and deterministic validation/);
  assert.match(readiness, /else if \(!validationStatus\)/);
});

test("artifact retries reuse durable upstream checkpoints", () => {
  assert.match(generator, /completedBusinessPlanPath/);
  assert.match(generator, /resumedSbaPackageId && completedBusinessPlanPath/);
  assert.match(generator, /existing\.projections_xlsx_path/);
  assert.match(generator, /current_stage: "feasibility_review"/);
  assert.match(generator, /loadFeasibilityStudyResult/);
  assert.match(feasibilityEngine, /Rehydrates a completed feasibility study/);
  assert.match(feasibilityEngine, /marketDemand: dimension\(marketDemand, weights\.marketDemand\)/);
  assert.match(feasibilityEngine, /financialViability: dimension\(financialViability, weights\.financialViability\)/);
  assert.match(feasibilityEngine, /operationalReadiness: dimension\(operationalReadiness, weights\.operationalReadiness\)/);
  assert.match(feasibilityEngine, /locationSuitability: dimension\(locationSuitability, weights\.locationSuitability\)/);
  assert.match(feasibilityEngine, /overallDataCompleteness: Number\(study\.data_completeness/);
  assert.match(generator, /reviewFeasibilityWithRetry/);
  assert.match(generator, /timed\?\\s\*out\|timeout\|429/);
  assert.match(generator, /retrying review only/);
  assert.ok(
    generator.indexOf("source_feasibility_id: sourceFeasibilityId") <
      generator.indexOf("await enrichFeasibilityStudy"),
    "the generated feasibility study must be checkpointed before external review",
  );
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
  assert.match(stages, /record_trident_bundle_stage/);
  assert.match(migration, /lease_token/);
  assert.match(migration, /finalize_trident_bundle_run/);
  assert.match(releaseGate, /synthetic_qa_deal_has_no_public_research_grade/);
  assert.match(releaseGate, /memo_research_preliminary_requires_lender_review/);
});


test("research tenant isolation uses the canonical bank membership wall", () => {
  assert.match(completionMigration, /to authenticated/);
  assert.match(completionMigration, /public\.bank_memberships/);
  assert.match(completionMigration, /membership\.user_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(completionMigration, /auth\.role\(\)/);
  assert.match(completionMigration, /revoke all on function public\.commission_golden_trident_qa_research/);
  assert.match(completionMigration, /grant execute[\s\S]*to service_role/);
});

test("the admitted snapshot includes borrower narrative and every research evidence layer", () => {
  assert.match(snapshot, /buddy_borrower_stories/);
  for (const table of [
    "buddy_research_sources",
    "buddy_research_facts",
    "buddy_research_inferences",
    "buddy_research_narratives",
    "buddy_research_quality_gates",
  ]) {
    assert.match(snapshot, new RegExp(table));
  }
  assert.match(snapshot, /version: 4/);
  assert.match(snapshot, /semanticTridentSnapshot/);
  assert.match(snapshot, /TRIDENT_VOLATILE_SNAPSHOT_KEYS/);
});


test("runtime certification reconciles abandoned bundles without broadening access", () => {
  assert.match(runtimeMigration, /reconcile_stale_trident_bundle_runs/);
  assert.match(runtimeMigration, /for update skip locked/i);
  assert.match(runtimeMigration, /buddy_trident_bundles_stale_lease_idx/);
  assert.match(runtimeMigration, /buddy_trident_bundle_stages/);
  assert.match(runtimeMigration, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(runtimeMigration, /grant execute[\s\S]*to service_role/i);
  assert.match(lockJanitor, /reconcile_stale_trident_bundle_runs/);
  assert.match(lockJanitor, /Promise\.all/);
  assert.match(lockJanitor, /tridentReconciled/);
  assert.match(
    reconciliationRepairMigration,
    /on conflict on constraint buddy_trident_bundle_stages_pkey/i,
  );
  assert.doesNotMatch(
    reconciliationRepairMigration,
    /on conflict\s*\(bundle_id,\s*stage\)/i,
  );
  assert.match(
    reconciliationRepairMigration,
    /revoke all[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    reconciliationRepairMigration,
    /grant execute[\s\S]*to service_role/i,
  );
  assert.match(
    terminalLeaseRepairMigration,
    /lease_token = null[\s\S]*lease_expires_at = null/i,
  );
  assert.match(
    terminalLeaseRepairMigration,
    /status = 'failed'[\s\S]*stage_error_json ->> 'code' = 'lease_expired'/i,
  );

  assert.match(
    terminalStageConvergenceMigration,
    /create or replace trigger buddy_trident_terminal_stage_convergence/i,
  );
  assert.match(
    terminalStageConvergenceMigration,
    /new\.status not in \('succeeded', 'failed'\)/i,
  );
  assert.match(
    terminalStageConvergenceMigration,
    /s\.status in \('pending', 'running'\)/i,
  );
  assert.match(terminalStageConvergenceMigration, /'parent_bundle_terminal'/i);
  assert.match(
    terminalStageConvergenceMigration,
    /revoke all[\s\S]*from public, anon, authenticated/i,
  );
});


test("scheduled marketplace cadence supports Vercel GET without diverging from POST", () => {
  assert.match(marketplaceCronRoute, /async function runMarketplaceCron/);
  assert.match(marketplaceCronRoute, /export const GET = runMarketplaceCron/);
  assert.match(marketplaceCronRoute, /export const POST = runMarketplaceCron/);
  assert.equal((marketplaceCronRoute.match(/verifyCronSecret\(request\)/g) ?? []).length, 1);
});


test("commissioning and release share one hardened, governed research contract", () => {
  const producedGrade = certificationMigration.match(
    /v_mission_id, p_deal_id, '([^']+)', true, 100/,
  )?.[1];
  const acceptedGrade = releaseGate.match(
    /TRIDENT_COMMITTEE_RESEARCH_GRADE = "([^"]+)"/,
  )?.[1];

  assert.equal(producedGrade, "committee_grade");
  assert.equal(producedGrade, acceptedGrade);
  assert.doesNotMatch(certificationMigration, /'A'\s*,\s*true\s*,\s*100/);
  assert.match(certificationMigration, /set search_path = ''/);
  assert.match(certificationMigration, /extensions\.digest/);
  assert.match(
    certificationMigration,
    /validate constraint buddy_research_inferences_input_fact_ids_nonempty/,
  );
  assert.match(certificationMigration, /test_suite = coalesce\(test_suite, 'golden-trident'\)/);
  assert.match(certificationMigration, /test_run_id = coalesce\(test_run_id, p_run_key\)/);
  assert.match(fixture, /test_suite: "golden-trident"/);
  assert.match(fixture, /test_run_id: FIXTURE_VERSION/);
});


test("input admission excludes factory-produced derivatives and canonicalizes before memo binding", () => {
  assert.match(snapshot, /version:\s*5/);
  assert.match(snapshot, /sources:\s*\{/);
  assert.match(snapshot, /derivedAtAdmission:\s*\{/);
  const sourcesStart = snapshot.indexOf("sources: {");
  const derivedStart = snapshot.indexOf("derivedAtAdmission: {");
  assert.ok(sourcesStart >= 0 && derivedStart > sourcesStart);
  const governedSources = snapshot.slice(sourcesStart, derivedStart);
  assert.doesNotMatch(governedSources, /financialSnapshots/);
  assert.doesNotMatch(governedSources, /validationReports/);
  assert.doesNotMatch(governedSources, /memoInputHash/);
  assert.ok(
    stages.indexOf("renderClassicPdfSpread(") <
      stages.indexOf("generateCanonicalMemoArtifact("),
    "Classic Spread must materialize the canonical financial snapshot before memo generation",
  );
  assert.match(stages, /memo_input_hash:\s*memo\.inputHash/);
  assert.match(workflow, /canonicalBinding/);
  assert.match(workflow, /\.\.\.canonicalBinding/);
});
