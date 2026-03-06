import type { CorpusDocument, CorpusTestResult } from "./types";

/**
 * Validate extracted facts against a golden corpus document.
 * Pure function — no DB, no side effects.
 */
export function validateAgainstCorpus(
  corpusDoc: CorpusDocument,
  extractedFacts: Record<string, number | null>
): CorpusTestResult {
  const failures: CorpusTestResult["failures"] = [];

  for (const [factKey, expected] of Object.entries(corpusDoc.groundTruth)) {
    const actual = extractedFacts[factKey] ?? null;
    const tolerance = corpusDoc.tolerances?.[factKey] ?? 1;

    if (expected === null && actual === null) {
      continue; // both null — pass
    }

    if (expected === null || actual === null) {
      // one is null and the other is not — fail
      failures.push({
        factKey,
        expected,
        actual,
        delta: null,
        tolerance,
      });
      continue;
    }

    const delta = Math.abs(actual - expected);
    if (delta > tolerance) {
      failures.push({
        factKey,
        expected,
        actual,
        delta,
        tolerance,
      });
    }
  }

  return {
    documentId: corpusDoc.id,
    passed: failures.length === 0,
    failures,
    testedAt: new Date().toISOString(),
  };
}
