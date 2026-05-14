#!/usr/bin/env tsx
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { runAllCommsQaScenarios, assertQaSafeMode } from "../src/lib/brokerage/commsQaHarness";
async function main() {
  console.log("BROKERAGE COMMS QA HARNESS");
  const guard = assertQaSafeMode();
  if (!guard.safe) { console.error(`BLOCKED: ${guard.reason}`); process.exit(1); }
  const r = await runAllCommsQaScenarios();
  for (const s of r.scenarios) {
    console.log(`[${s.passed?"PASS":"FAIL"}] ${s.name}`);
    for (const c of s.checks.filter(c=>!c.passed)) console.log(`  !! ${c.name}: ${c.detail}`);
  }
  console.log(`\n${r.passed?"ALL SCENARIOS PASSED":"SOME SCENARIOS FAILED"} (${r.scenarios.length} scenarios)`);
  process.exit(r.passed?0:1);
}
main().catch(e=>{console.error(e);process.exit(1)});
