#!/usr/bin/env tsx
import { runBusinessReadinessGate } from "../src/lib/brokerage/businessReadinessGate";
const skipBuild = process.argv.includes("--skip-build");
const skipGolden = process.argv.includes("--skip-golden");
const strict = process.argv.includes("--strict");
const json = process.argv.includes("--json");
async function main() {
  const result = await runBusinessReadinessGate({ skipBuild, skipGolden, strict });
  if (json) { console.log(JSON.stringify(result, null, 2)); } else {
    console.log("SBA BROKERAGE READINESS GATE");
    for (const g of result.gates) console.log(`  [${g.status.toUpperCase()}] ${g.name} — ${g.details}`);
    console.log(`Status: ${result.overall}  Critical: ${result.critical}  Warning: ${result.warning}`);
    console.log(result.overall === "READY" ? "READY." : "NOT READY.");
  }
  process.exit(result.overall === "READY" ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
