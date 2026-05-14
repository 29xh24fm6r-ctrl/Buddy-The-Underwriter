#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { runDryRunVerification } from "../src/lib/brokerage/commsRollout";
async function main() {
  console.log("COMMS DRY-RUN VERIFICATION");
  const r = await runDryRunVerification();
  console.log(`Readiness: ${r.readiness.status}`);
  if (r.qaResult) console.log(`QA: ${r.qaResult.passed?"PASSED":"FAILED"} (${r.qaResult.scenarioCount} scenarios)`);
  if (r.error) console.log(`Error: ${r.error}`);
  console.log(r.ok ? "DRY-RUN PASSED" : "DRY-RUN FAILED");
  process.exit(r.ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
