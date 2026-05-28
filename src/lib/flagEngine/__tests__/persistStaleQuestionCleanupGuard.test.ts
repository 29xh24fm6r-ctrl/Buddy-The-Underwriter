/**
 * BUGFIX-BORROWER-QUESTION-STALE-SUPPRESSION-CLEANUP-1 — CI Guard Tests
 *
 * Guards:
 * 1. persistFlagReport deletes stale borrower questions when evidence gate suppresses
 * 2. deleteStaleBorrowerQuestion helper exists
 * 3. has_borrower_question is set to false when question is null
 * 4. questionGenerator evidence gate suppresses cross-period questions
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const PERSIST = read("src/lib/flagEngine/persistFlagReport.ts");
const QUESTION_GEN = read("src/lib/flagEngine/questionGenerator.ts");
const RECON = read("src/lib/flagEngine/flagFromReconciliation.ts");

describe("BUGFIX-BORROWER-QUESTION-STALE-SUPPRESSION-CLEANUP-1 guards", () => {

  test("Guard 1: persistFlagReport calls deleteStaleBorrowerQuestion when question is null", () => {
    assert.match(
      PERSIST,
      /deleteStaleBorrowerQuestion\(sb, dealId, flag\)/,
      "Must call deleteStaleBorrowerQuestion in the else branch when borrower_question is null",
    );
  });

  test("Guard 2: deleteStaleBorrowerQuestion deletes from deal_borrower_questions", () => {
    assert.match(
      PERSIST,
      /\.delete\(\)\s*\n?\s*\.eq\("flag_id"/,
      "Must delete deal_borrower_questions by flag_id",
    );
  });

  test("Guard 3: has_borrower_question reflects suppression", () => {
    assert.match(
      PERSIST,
      /has_borrower_question: flag\.borrower_question !== null/,
      "has_borrower_question must be false when evidence gate suppresses",
    );
  });

  test("Guard 4: questionGenerator returns null for cross-period revenue_variance", () => {
    assert.match(
      QUESTION_GEN,
      /checkEvidenceGate/,
      "generateQuestion must call evidence gate before producing question",
    );
    assert.match(
      QUESTION_GEN,
      /return null/,
      "generateQuestion must return null when evidence gate fails",
    );
  });

  test("Guard 5: flagFromReconciliation annotates banker_detail when question suppressed", () => {
    assert.match(
      RECON,
      /Borrower question suppressed/,
      "Must annotate banker_detail when question is suppressed by evidence gate",
    );
    assert.match(
      RECON,
      /Internal review required/,
      "Annotation must include 'Internal review required'",
    );
  });
});
