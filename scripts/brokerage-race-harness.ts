#!/usr/bin/env tsx
import { runRaceHarness } from "../src/lib/brokerage/raceHarness";
async function main() {
  console.log("BROKERAGE RACE HARNESS");
  const s = process.argv.indexOf("--scenario");
  const result = await runRaceHarness({ scenario: s >= 0 ? process.argv[s+1] : undefined });
  for (const sc of result.scenarios) console.log(`[${sc.ok?"PASS":"FAIL"}] ${sc.name} (${sc.elapsed}ms)`);
  console.log(`Total: ${result.total}  Passed: ${result.passed}  Failed: ${result.failed}`);
  process.exit(result.ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
