import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

const extraction = read("src/lib/financialSpreads/extractFactsFromDocument.ts");
const writer = read("src/lib/financialFacts/writeFact.ts");
const access = read("src/lib/tenant/ensureDealBankAccess.ts");
const spreads = read("src/lib/jobs/processors/spreadsProcessor.ts");
const refresh = read("src/lib/deals/readiness/refreshDealReadiness.ts");
const readiness = read("src/lib/deals/readiness/buildUnifiedDealReadiness.ts");
const persistedReadiness = read("src/lib/deals/readiness.ts");
const checklist = read("src/lib/checklist/engine.ts");
const intake = read("src/lib/intake/processing/processConfirmedIntake.ts");
const aegisWriter = read("src/lib/aegis/writeSystemEvent.ts");
const alertSender = read("src/lib/observability/sendBankerAnalysisAlert.ts");

test("periodless extraction heartbeat explicitly opts into sentinel metadata persistence", () => {
  const heartbeat = extraction.indexOf('factType: "EXTRACTION_HEARTBEAT"');
  assert.ok(heartbeat >= 0, "heartbeat write is missing");
  const block = extraction.slice(heartbeat, heartbeat + 900);
  assert.match(block, /allowSentinelPeriod:\s*true/);
  assert.match(writer, /EXTRACTION_HEARTBEAT metadata row opts in explicitly/);
  assert.match(writer, /args\.allowSentinelPeriod === true/);
});

test("spreads worker uses a verified deal-bank grant instead of browser-session auth", () => {
  assert.match(access, /export async function ensureDealBankAccessForService/);
  assert.match(access, /\.from\("deals"\)/);
  assert.match(access, /deal\.bank_id !== expectedBankId/);
  assert.match(access, /grant:\s*issueGrant\(deal\.id, deal\.bank_id\)/);

  assert.match(spreads, /ensureDealBankAccessForService\(dealId, bankId\)/);
  assert.match(spreads, /accessGrant:\s*serviceAccess\.grant/);
  assert.match(spreads, /readinessAccessGrant\s*=\s*serviceAccess\.grant/);
  assert.match(
    spreads,
    /recomputeDealReady\(dealId,\s*\{[\s\S]*?accessGrant:\s*readinessAccessGrant/,
  );
  assert.doesNotMatch(spreads, /await recomputeDealReady\(dealId\);/);
  assert.match(refresh, /accessGrant:\s*args\.accessGrant/);
  assert.match(readiness, /isDealBankAccessGrantFor/);
  assert.match(readiness, /accessGrant:\s*access\.grant/);
  assert.match(persistedReadiness, /accessGrant:\s*context\.accessGrant/);
  assert.match(persistedReadiness, /actorId:\s*context\.actorId/);
  assert.match(
    persistedReadiness,
    /reconcileChecklistForDeal\(\{[\s\S]*?accessGrant:\s*context\.accessGrant/,
  );
  assert.match(checklist, /accessGrant\?:\s*DealBankAccessGrant/);
  assert.match(checklist, /accessGrant:\s*opts\.accessGrant/);
  assert.match(intake, /ensureDealBankAccessForService\(dealId, bankId\)/);
  assert.match(intake, /service_access:\$\{serviceAccess\.error\}/);
  assert.match(intake, /accessGrant:\s*serviceAccess\.grant/);
  assert.match(
    intake,
    /scheduleReadinessRefresh\(\{[\s\S]*?\.\.\.opts\.readinessContext/,
  );
});

test("browser readiness callers still retain canonical session authorization", () => {
  assert.match(readiness, /:\s*await ensureDealBankAccess\(args\.dealId\)/);
  assert.match(access, /const auth = await clerkAuth\(\)/);
});

test("Aegis informational compatibility alias cannot violate the persisted enum", () => {
  assert.match(
    aegisWriter,
    /event\.event_type === "info" \? "success" : event\.event_type/,
  );
  assert.match(alertSender, /SYSTEM_EVENT_TYPE = "success"/);
  assert.doesNotMatch(alertSender, /SYSTEM_EVENT_TYPE = "info"/);
});
