/**
 * Phase 81: Golden-Set Evaluation Runner
 *
 * Runs the subject lock validation against all golden-set cases
 * and reports pass/fail with regression detection.
 *
 * Usage: node --import tsx src/lib/research/evals/runGoldenSetEval.ts
 *
 * CI integration: exits with code 1 if any regression is detected.
 */

import { GOLDEN_SET } from "./goldenSet";
import { validateSubjectLock } from "../subjectLock";

type EvalResult = {
  id: string;
  name: string;
  subjectLockPassed: boolean;
  expectedSubjectLockPasses: boolean;
  subjectLockMatch: boolean;
  reasons: string[];
  notes: string;
};

export function runGoldenSetEval(): {
  results: EvalResult[];
  passed: number;
  failed: number;
  regressions: string[];
} {
  const results: EvalResult[] = [];
  const regressions: string[] = [];

  for (const testCase of GOLDEN_SET) {
    const lockResult = validateSubjectLock({
      company_name: testCase.subject.company_name,
      naics_code: testCase.subject.naics_code,
      naics_description: testCase.subject.naics_description,
      business_description: testCase.subject.business_description,
      city: testCase.subject.city,
      state: testCase.subject.state,
      geography: testCase.subject.geography,
      website: testCase.subject.website,
      dba: testCase.subject.dba,
      banker_summary: testCase.subject.banker_summary,
    });

    const subjectLockMatch = lockResult.ok === testCase.expected.subjectLockPasses;

    if (!subjectLockMatch) {
      regressions.push(
        `${testCase.id}: subject lock ${lockResult.ok ? "PASSED" : "FAILED"} but expected ${testCase.expected.subjectLockPasses ? "PASS" : "FAIL"}`,
      );
    }

    results.push({
      id: testCase.id,
      name: testCase.name,
      subjectLockPassed: lockResult.ok,
      expectedSubjectLockPasses: testCase.expected.subjectLockPasses,
      subjectLockMatch,
      reasons: lockResult.ok ? [] : (lockResult as any).reasons ?? [],
      notes: testCase.expected.notes,
    });
  }

  const passed = results.filter((r) => r.subjectLockMatch).length;
  const failed = results.filter((r) => !r.subjectLockMatch).length;

  return { results, passed, failed, regressions };
}

// CLI runner
if (typeof process !== "undefined" && process.argv[1]?.includes("runGoldenSetEval")) {
  const { results, passed, failed, regressions } = runGoldenSetEval();

  console.log("\n=== Phase 81: Golden-Set Evaluation ===\n");
  for (const r of results) {
    const icon = r.subjectLockMatch ? "✓" : "✗";
    const lockIcon = r.subjectLockPassed ? "🔓" : "🔒";
    console.log(`${icon} ${lockIcon} ${r.name}`);
    if (r.reasons.length > 0) {
      console.log(`     Reasons: ${r.reasons.join("; ")}`);
    }
    console.log(`     ${r.notes}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  if (regressions.length > 0) {
    console.error("\n❌ REGRESSIONS DETECTED:");
    for (const r of regressions) {
      console.error(`  - ${r}`);
    }
    process.exit(1);
  }

  console.log("\n✓ No regressions detected.");
  process.exit(0);
}
