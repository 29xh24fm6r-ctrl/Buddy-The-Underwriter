import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("brokerage artifact inspection uses one scoped tenant boundary", () => {
  const paths = [
    "src/app/(app)/deals/[dealId]/classic-spreads/page.tsx",
    "src/app/(app)/deals/[dealId]/layout.tsx",
    "src/app/api/deals/[dealId]/lifecycle/route.ts",
    "src/app/api/deals/[dealId]/progress/route.ts",
    "src/app/api/deals/[dealId]/committee-anticipation/route.ts",
  ];
  for (const path of paths) {
    assert.match(read(path), /ensureDealBankAccessAllowingBrokerageStaff/);
  }
  const committeeRoute = read(paths[4]);
  assert.doesNotMatch(committeeRoute, /requireDealAccess|rethrowNextErrors/);
  assert.match(committeeRoute, /accessGrant: access\.grant/);
  assert.match(committeeRoute, /NextResponse\.json/);

  const committeeBuilder = read(
    "src/lib/creditMemo/committee/buildCommitteeAnticipation.ts",
  );
  const memoBuilder = read(
    "src/lib/creditMemo/inputs/buildMemoInputPackage.ts",
  );
  for (const builder of [committeeBuilder, memoBuilder]) {
    assert.match(builder, /accessGrant\?: DealBankAccessGrant/);
    assert.match(builder, /isDealBankAccessGrantFor/);
  }
  assert.match(committeeBuilder, /accessGrant: access\.grant/);
});

test("committee anticipation never assumes an HTML response is JSON", () => {
  const panel = read("src/components/creditMemo/CommitteeAnticipationPanel.tsx");
  assert.match(panel, /headers\.get\("content-type"\)/);
  assert.match(panel, /contentType\.includes\("application\/json"\)/);
  assert.match(panel, /Committee service returned HTTP/);
});

test("scheduled brokerage cleanup supports Vercel GET and records durable evidence", () => {
  const route = read("src/app/api/cron/brokerage/cleanup-expired/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /scope: "brokerage_session_cleanup"/);
  assert.match(route, /action: failures\.length === 0 \? "completed" : "failed"/);
  assert.match(route, /delete\(\{ count: "exact" \}\)/);
});

test("readiness distinguishes production defects from synthetic evidence", () => {
  const page = read("src/app/admin/brokerage/launch-readiness/page.tsx");
  assert.match(page, /select\("id, created_at, is_test"\)/);
  assert.match(page, /deal\.is_test === true/);
  assert.match(page, /synthetic row\(s\) excluded/);
  assert.match(page, /order\("created_at", \{ ascending: true \}\)/);
  assert.match(page, /\.limit\(1000\)/);
  assert.match(page, /scope", "synth_borrower_e2e"/);
  assert.match(page, /scope", "brokerage_session_cleanup"/);
  assert.doesNotMatch(page, /\.ci\/synth-borrower-e2e-report\.json/);
});

test("synthetic evidence is durable and upload recovery stays authoritative", () => {
  const runner = read("scripts/synth-borrower-e2e.ts");
  const recovery = read("src/lib/workers/recoverStuckIntakeDeals.ts");
  assert.match(runner, /rest\/v1\/ai_events/);
  assert.match(runner, /scope: "synth_borrower_e2e"/);
  assert.match(runner, /await persistDurableReport\(report, passedGate\)/);
  assert.match(recovery, /queueArtifact/);
  assert.match(recovery, /MAX_ARTIFACT_RETRIES = 3/);
  assert.match(recovery, /\.limit\(MAX_RECOVERIES_PER_RUN\)/);
  assert.match(recovery, /artifact\.status === "failed"/);
  assert.match(recovery, /intake\.upload_artifact_recovery/);
  assert.doesNotMatch(recovery, /backfillDealArtifacts/);
  assert.doesNotMatch(recovery, /finalized_at:\s*(new Date|ranAt|now)/);
});
