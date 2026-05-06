/**
 * Memo Input Submission Guard
 *
 * Verifies the contract between submitCreditMemoToUnderwriting and the
 * memo input completeness layer at the source-code level. We don't run
 * the submission against a live DB here — that's covered by route tests
 * — but we DO verify the call site is wired correctly:
 *
 *   1. submitCreditMemoToUnderwriting imports buildMemoInputPackage
 *   2. submitCreditMemoToUnderwriting imports evaluateMemoInputReadiness
 *   3. The "input_readiness_failed" reason is reachable from the function
 *   4. The package is attached to the snapshot's data_sources_json
 *   5. BankerReviewPanel does not bypass the server gate
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const SUBMIT = join(
  REPO_ROOT,
  "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts",
);
const PANEL = join(REPO_ROOT, "src/components/creditMemo/BankerReviewPanel.tsx");

function readSubmit(): string {
  return readFileSync(SUBMIT, "utf8");
}

test("[submit-1] submitCreditMemoToUnderwriting imports buildMemoInputPackage", () => {
  const body = readSubmit();
  assert.ok(
    body.includes("buildMemoInputPackage") && body.includes('@/lib/creditMemo/inputs/buildMemoInputPackage'),
    "submitCreditMemoToUnderwriting must import buildMemoInputPackage",
  );
});

test("[submit-2] submitCreditMemoToUnderwriting imports evaluateMemoInputReadiness", () => {
  const body = readSubmit();
  assert.ok(
    body.includes("evaluateMemoInputReadiness") &&
      body.includes('@/lib/creditMemo/inputs/evaluateMemoInputReadiness'),
    "submitCreditMemoToUnderwriting must import evaluateMemoInputReadiness",
  );
});

test("[submit-3] input_readiness_failed reason exists in submission flow", () => {
  const body = readSubmit();
  assert.ok(
    body.includes('"input_readiness_failed"'),
    "Submission must reject with input_readiness_failed reason when input layer blocks",
  );
});

test("[submit-4] memo input package is attached to data_sources_json", () => {
  const body = readSubmit();
  assert.ok(
    body.includes("memo_input_package") &&
      /data_sources_json[\s\S]*?memo_input_package/.test(body),
    "submitCreditMemoToUnderwriting must attach memo_input_package to data_sources_json",
  );
});

test("[submit-5] BankerReviewPanel cannot submit without the server gate", () => {
  const body = readFileSync(PANEL, "utf8");
  // The panel must hit the server submit endpoint — it cannot mutate the
  // status directly. Direct supabase calls from the panel are forbidden.
  assert.ok(
    !body.includes("from('credit_memo_snapshots')") &&
      !body.includes('from("credit_memo_snapshots")'),
    "BankerReviewPanel must not write directly to credit_memo_snapshots",
  );
  assert.ok(
    body.includes("/api/deals/") && body.includes("credit-memo/submit"),
    "BankerReviewPanel must submit through the /api/deals/[dealId]/credit-memo/submit route",
  );
});
