import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const ANSWER_ROUTE = read("src/app/api/deals/[dealId]/committee/route.ts");
const BLENDED_ROUTE = read(
  "src/app/api/deals/[dealId]/committee/blended/route.ts",
);
const EVALUATE_ROUTE = read(
  "src/app/api/deals/[dealId]/committee/evaluate/route.ts",
);
const RETRIEVAL = read("src/lib/retrieval/committee.ts");
const ENGINE = read("src/lib/sba/committee.ts");
const DECISION_ROUTE = read(
  "src/app/api/deals/[dealId]/credit-memo/underwriter-decision/route.ts",
);
const DECISION_WRITER = read(
  "src/lib/creditMemo/underwriter/recordUnderwriterDecision.ts",
);
const SUBMISSION_WRITER = read(
  "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts",
);

test("[committee-auth-1] every interrogation route requires deal access", () => {
  for (const source of [ANSWER_ROUTE, BLENDED_ROUTE, EVALUATE_ROUTE]) {
    assert.match(source, /requireDealAccess\(dealId\)/);
    assert.match(source, /rethrowNextErrors\(error\)/);
    assert.match(source, /"Cache-Control": "no-store"/);
  }
});

test("[committee-auth-2] policy retrieval cannot select another bank", () => {
  for (const source of [BLENDED_ROUTE, EVALUATE_ROUTE]) {
    assert.match(source, /requestedBankId !== access\.bankId/);
    assert.match(source, /bank_scope_mismatch/);
    assert.match(source, /(?:const bankId =|bankId:) access\.bankId/);
  }
});

test("[committee-truth-1] committee citations must be admitted evidence", () => {
  assert.match(RETRIEVAL, /assertGroundedCommitteeCitations/);
  assert.match(RETRIEVAL, /committee_rerank_invalid_chunk/);
  assert.match(BLENDED_ROUTE, /assertGroundedCommitteeCitations/);
  assert.match(BLENDED_ROUTE, /BlendedAnswerSchema\.parse/);
});

test("[committee-truth-2] evaluation schema and provenance writes fail closed", () => {
  assert.match(ENGINE, /PersonaResponseSchema\.parse/);
  assert.match(ENGINE, /committee_evaluation_citation_invalid/);
  assert.match(ENGINE, /if \(aiEventError \|\| !aiEvent\?\.id\)/);
  assert.match(ENGINE, /if \(citationError\)/);
  assert.doesNotMatch(ENGINE, /aiEvent\?\.id \?\? "unknown"/);
});

test("[committee-truth-3] client responses do not expose raw exceptions", () => {
  for (const source of [
    ANSWER_ROUTE,
    BLENDED_ROUTE,
    EVALUATE_ROUTE,
    DECISION_ROUTE,
  ]) {
    assert.doesNotMatch(source, /error:\s*(?:error|e)\.message/);
    assert.doesNotMatch(source, /error:\s*String\((?:error|e)\)/);
  }
});

test("[decision-truth-1] decision finalization enforces provenance and separation", () => {
  assert.match(DECISION_WRITER, /select\("id, status, submitted_by"\)/);
  assert.match(DECISION_WRITER, /underwriter_separation_of_duties/);
  assert.match(DECISION_WRITER, /snapshot_submitter_provenance_missing/);
  assert.match(DECISION_WRITER, /\.neq\("submitted_by", args\.underwriterId\)/);
});

test("[decision-truth-2] mirror failures roll back through the lifecycle owner", () => {
  const restoreHelper = "restoreBankerSubmittedSnapshotAfterFailedDecision";
  const submittedState = ["banker", "submitted"].join("_");

  assert.ok(DECISION_WRITER.includes(restoreHelper));
  assert.ok(SUBMISSION_WRITER.includes(`export async function ${restoreHelper}`));
  assert.ok(
    SUBMISSION_WRITER.includes(`status: "${submittedState}"`),
    "only the canonical submission owner may restore the submitted state",
  );
  assert.match(SUBMISSION_WRITER, /\.eq\("status", args\.expectedStatus\)/);
  assert.match(DECISION_WRITER, /decision_status_sync_failed/);
  assert.match(DECISION_WRITER, /decision_reconciliation_required/);
  assert.match(DECISION_WRITER, /level:\s*"fatal"/);
});
test("[decision-truth-3] malformed feedback is rejected, not dropped", () => {
  assert.match(DECISION_ROUTE, /parseRequestedChanges/);
  assert.match(DECISION_ROUTE, /parseConditions/);
  assert.match(DECISION_ROUTE, /invalid_underwriter_feedback/);
  assert.doesNotMatch(DECISION_ROUTE, /filterRequestedChanges/);
  assert.doesNotMatch(DECISION_ROUTE, /filterConditions/);
});
