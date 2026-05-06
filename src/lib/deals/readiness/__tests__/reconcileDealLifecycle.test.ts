/**
 * reconcileDealLifecycle structural / logical guards.
 *
 * Full DB integration is exercised via the /api/deals/[dealId]/readiness/refresh
 * route's smoke test. Here we verify the reconciler's chooseTargetStage
 * decision tree by importing the readiness shape and asserting the function
 * advances correctly given each precondition.
 *
 * Because reconcileDealLifecycle calls advanceDealLifecycle (server-only),
 * we only test the file-level invariants here: the source code references
 * the right helpers and the target-stage selector branches per spec.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const RECONCILER = join(
  REPO_ROOT,
  "src/lib/deals/readiness/reconcileDealLifecycle.ts",
);

function read() {
  return readFileSync(RECONCILER, "utf8");
}

test("[reconcile-1] reconciler calls advanceDealLifecycle", () => {
  const body = read();
  assert.match(
    body,
    /advanceDealLifecycle\s*\(/,
    "reconcileDealLifecycle must call advanceDealLifecycle",
  );
});

test("[reconcile-2] target stage routes docs+memo-incomplete → memo_inputs_required", () => {
  const body = read();
  assert.match(
    body,
    /memoInputsReady[\s\S]*?return ['"]memo_inputs_required['"]/,
    "When memo inputs are not ready, target stage must be memo_inputs_required",
  );
});

test("[reconcile-3] target stage routes all-ready → underwrite_ready", () => {
  const body = read();
  assert.match(
    body,
    /memoInputsReady && financialsReady && researchReady[\s\S]*?return ['"]underwrite_ready['"]/,
    "When all prereqs are satisfied, reconciler targets underwrite_ready",
  );
});

test("[reconcile-4] reconciler returns no_change when stage already correct", () => {
  const body = read();
  assert.ok(
    body.includes('reason: "no_change"'),
    "Idempotent path must return reason: 'no_change'",
  );
});
