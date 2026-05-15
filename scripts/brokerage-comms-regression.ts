#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { runAllCommsQaScenarios, assertQaSafeMode } from "../src/lib/brokerage/commsQaHarness";
import { runReadinessCheck } from "../src/lib/brokerage/commsRollout";
async function main() {
  console.log("BROKERAGE COMMS REGRESSION SWEEP\n");
  // 1. Readiness
  const readiness = runReadinessCheck();
  console.log(`Readiness: ${readiness.readiness.status} (exit ${readiness.exitCode})`);
  // 2. QA harness
  const guard = assertQaSafeMode();
  if (!guard.safe) { console.log(`QA blocked: ${guard.reason}`); process.exit(1); }
  const qa = await runAllCommsQaScenarios();
  console.log(`QA: ${qa.passed ? "PASSED" : "FAILED"} (${qa.scenarios.length} scenarios)`);
  for (const s of qa.scenarios.filter(s => !s.passed)) {
    console.log(`  [FAIL] ${s.name}`);
    for (const c of s.checks.filter(c => !c.passed)) console.log(`    !! ${c.name}: ${c.detail}`);
  }
  console.log(`\n${qa.passed ? "REGRESSION SWEEP PASSED" : "REGRESSION SWEEP FAILED"}`);
  process.exit(qa.passed ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
