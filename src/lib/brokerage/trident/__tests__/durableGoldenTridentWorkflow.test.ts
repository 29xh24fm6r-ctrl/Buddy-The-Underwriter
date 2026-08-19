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

test("final Trident generation is accepted into a multi-stage durable workflow", () => {
  assert.match(route, /start\(goldenTridentWorkflow/);
  assert.match(route, /status:\s*202/);
  assert.doesNotMatch(route, /await generateTridentBundle/);
  assert.match(workflow, /"use workflow"/);
  assert.equal((workflow.match(/"use step"/g) ?? []).length, 5);
  assert.match(workflow, /prepare\(args\)/);
  assert.match(workflow, /canonical\(/);
  assert.match(workflow, /artifacts\(args\)/);
  assert.match(workflow, /manifest\(args\)/);
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
});
