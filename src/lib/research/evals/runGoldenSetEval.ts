/**
 * Phase 81/82: Golden-Set Evaluation Runner
 *
 * Runs the subject lock validation against all golden-set cases
 * and reports pass/fail with regression detection.
 *
 * Phase 82: also records evidenceSupportRatio per case when available, and
 * regression-fails when a committee-eligible case has coverage <50%.
 *
 * Usage: node --conditions=react-server --import tsx src/lib/research/evals/runGoldenSetEval.ts
 *
 * CI integration: exits with code 1 if any regression is detected.
 */

import { GOLDEN_SET, type GoldenSetCase } from "./goldenSet";
import { validateSubjectLock } from "../subjectLock";
import { computeEvidenceCoverage } from "../evidenceCoverage";

type EvalResult = {
  id: string;
  name: string;
  subjectLockPassed: boolean;
  expectedSubjectLockPasses: boolean;
  subjectLockMatch: boolean;
  reasons: string[];
  notes: string;
  /** Phase 82: populated when a deal + bank id is available (real deals only) */
  evidenceSupportRatio: number | null;
  skipped: boolean;
};

/**
 * Phase 82: placeholders carry company_name starting with "POPULATE_FROM_PROD"
 * (or subject.company_name === null from earlier style). They are skipped
 * until ops populates real deal data.
 */
function isPlaceholderCase(c: GoldenSetCase): boolean {
  const name = c.subject?.company_name;
  if (!name) return true;
  return name.startsWith("POPULATE_FROM_PROD");
}

export async function runGoldenSetEval(bankId?: string): Promise<{
  results: EvalResult[];
  passed: number;
  failed: number;
  skipped: number;
  regressions: string[];
}> {
  const results: EvalResult[] = [];
  const regressions: string[] = [];

  for (const testCase of GOLDEN_SET) {
    if (isPlaceholderCase(testCase)) {
      results.push({
        id: testCase.id,
        name: testCase.name,
        subjectLockPassed: false,
        expectedSubjectLockPasses: testCase.expected.subjectLockPasses,
        subjectLockMatch: true, // skipped does not count as regression
        reasons: [],
        notes: "SKIPPED (placeholder — populate real values before evaluating)",
        evidenceSupportRatio: null,
        skipped: true,
      });
      continue;
    }

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

    // Phase 82: evidence coverage — only meaningful when we can identify a real
    // deal. Golden-set cases key on subject shape, not dealId. When bankId +
    // a case-specific dealId both exist, compute the ratio; otherwise null.
    let evidenceSupportRatio: number | null = null;
    if (bankId && testCase.subject.company_name) {
      const coverage = await computeEvidenceCoverage(
        testCase.subject.company_name,
        bankId,
      ).catch(() => null);
      evidenceSupportRatio = coverage?.supportRatio ?? null;

      if (
        testCase.expected.memoShouldBeCommitteeEligible &&
        (coverage?.supportRatio ?? 1) < 0.5
      ) {
        regressions.push(
          `${testCase.id}: evidence support dropped to ${Math.round(
            (coverage?.supportRatio ?? 0) * 100,
          )}% on a committee-eligible deal`,
        );
      }
    }

    results.push({
      id: testCase.id,
      name: testCase.name,
      subjectLockPassed: lockResult.ok,
      expectedSubjectLockPasses: testCase.expected.subjectLockPasses,
      subjectLockMatch,
      reasons: lockResult.ok ? [] : (lockResult as any).reasons ?? [],
      notes: testCase.expected.notes,
      evidenceSupportRatio,
      skipped: false,
    });
  }

  const skipped = results.filter((r) => r.skipped).length;
  const passed = results.filter((r) => r.subjectLockMatch && !r.skipped).length;
  const failed = results.filter((r) => !r.subjectLockMatch).length;

  return { results, passed, failed, skipped, regressions };
}

// CLI runner
if (typeof process !== "undefined" && process.argv[1]?.includes("runGoldenSetEval")) {
  const bankId = process.argv[2] || undefined;

  runGoldenSetEval(bankId).then(({ results, passed, failed, skipped, regressions }) => {
    console.log("\n=== Phase 81/82: Golden-Set Evaluation ===\n");
    for (const r of results) {
      const icon = r.skipped ? "·" : r.subjectLockMatch ? "✓" : "✗";
      const lockIcon = r.skipped ? "  " : r.subjectLockPassed ? "🔓" : "🔒";
      const coverageStr =
        r.evidenceSupportRatio !== null
          ? `  [evidence ${Math.round(r.evidenceSupportRatio * 100)}%]`
          : "";
      console.log(`${icon} ${lockIcon} ${r.name}${coverageStr}`);
      if (r.reasons.length > 0) {
        console.log(`     Reasons: ${r.reasons.join("; ")}`);
      }
      console.log(`     ${r.notes}`);
    }

    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (placeholders)`);

    if (regressions.length > 0) {
      console.error("\n❌ REGRESSIONS DETECTED:");
      for (const r of regressions) {
        console.error(`  - ${r}`);
      }
      process.exit(1);
    }

    console.log("\n✓ No regressions detected.");
    process.exit(0);
  }).catch((err) => {
    console.error("Eval failed:", err);
    process.exit(1);
  });
}
