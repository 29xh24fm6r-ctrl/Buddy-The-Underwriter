/**
 * SPEC-FINENGINE-COMPLETE-BUILD-1 Workstream B — the blocking spread-regression gate.
 *
 * Runs the multi-deal spread validation over the committed fixture deals and exits
 * non-zero on ANY UNEXPECTED divergence (a change that silently breaks a deal's
 * spread vs the independent golden). Wired into `pnpm guard:all`, so it gates both
 * PR merges and direct pushes to main.
 *
 * Run:  pnpm tsx scripts/finengine-spread-regression.ts
 */

import process from "node:process";
import { runSpreadRegression, formatRegressionReport } from "@/lib/finengine/spread/spreadRegression";
import { REGRESSION_DEALS } from "@/lib/finengine/__tests__/__fixtures__/regressionDeals";

const report = runSpreadRegression(REGRESSION_DEALS);
console.log(`\nfinengine spread regression — ${report.results.length} deal(s):`);
console.log(formatRegressionReport(report));

if (report.failed) {
  console.error(`\n❌ guard-finengine-spread-regression FAILED: ${report.totalUnexpected} UNEXPECTED divergence(s) vs the independent golden. Root-cause or register an INTENDED exception before merging.\n`);
  process.exit(1);
}
console.log(`\n✅ guard-finengine-spread-regression passed — every deal validates cutover-clean (0 UNEXPECTED).\n`);
