/**
 * SPEC-FLOW-V1 PR3 — Submission lifecycle event CI guard.
 *
 * Source-level invariant: submitCreditMemoToUnderwriting must call
 * advanceDealLifecycle exactly once (after the snapshot insert) and must
 * reference LedgerEventType.lifecycle_advance_attempted on the failure
 * path so blockers are captured for observability.
 *
 * Deliberately does NOT assert anything about scheduleReadinessRefresh.
 * That call site is owned and enforced by [v11-6] in
 * src/lib/deals/readiness/__tests__/perfectBankerFlowV11Guard.test.ts.
 * Adding an inverse assertion here would create a contradiction with
 * [v11-6] — the two guards must remain compatible.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const SUBMISSION_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts",
);
const EVENTS_PATH = join(REPO_ROOT, "src/buddy/lifecycle/events.ts");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

test("[lifecycle-event-guard-1] submission imports advanceDealLifecycle", () => {
  const body = read(SUBMISSION_PATH);
  assert.match(
    body,
    /import\s*\{\s*advanceDealLifecycle\s*\}\s*from\s+["']@\/buddy\/lifecycle\/advanceDealLifecycle["']/,
    "submitCreditMemoToUnderwriting must import advanceDealLifecycle from the canonical lifecycle helper module.",
  );
});

test("[lifecycle-event-guard-2] submission imports writeEvent + LedgerEventType", () => {
  const body = read(SUBMISSION_PATH);
  assert.match(
    body,
    /import\s*\{\s*writeEvent\s*\}\s*from\s+["']@\/lib\/ledger\/writeEvent["']/,
    "submitCreditMemoToUnderwriting must import writeEvent from the canonical ledger writer.",
  );
  assert.match(
    body,
    /import\s*\{\s*LedgerEventType\s*\}\s*from\s+["']@\/buddy\/lifecycle\/events["']/,
    "submitCreditMemoToUnderwriting must import LedgerEventType to address event kinds by symbol.",
  );
});

test("[lifecycle-event-guard-3] submission calls advanceDealLifecycle exactly once", () => {
  const body = read(SUBMISSION_PATH);
  // Strip line and block comments before matching so the SR-2 coexistence
  // comment block (which mentions advanceDealLifecycle in prose) doesn't
  // inflate the call count. Then count true call sites: an identifier
  // followed by `(args.dealId` is the canonical call shape.
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const callMatches =
    stripped.match(/(?<![\w.])advanceDealLifecycle\s*\(\s*args\.dealId/g) ?? [];
  assert.equal(
    callMatches.length,
    1,
    `Expected exactly one call site advanceDealLifecycle(args.dealId, ...) in submitCreditMemoToUnderwriting.ts; found ${callMatches.length}.`,
  );
});

test("[lifecycle-event-guard-4] submission references LedgerEventType.lifecycle_advance_attempted on failure path", () => {
  const body = read(SUBMISSION_PATH);
  assert.match(
    body,
    /LedgerEventType\.lifecycle_advance_attempted/,
    "submitCreditMemoToUnderwriting must emit LedgerEventType.lifecycle_advance_attempted when the advance fails or throws.",
  );
});

test("[lifecycle-event-guard-5] submission's advance call uses banker actor context", () => {
  const body = read(SUBMISSION_PATH);
  // The call site must pass an ActorContext with type:"banker" and the
  // banker id. Match within a short window around the call.
  const re =
    /advanceDealLifecycle\s*\(\s*args\.dealId\s*,\s*\{\s*type\s*:\s*["']banker["']\s*,\s*id\s*:\s*args\.bankerId\s*,?\s*\}\s*\)/;
  assert.match(
    body,
    re,
    "advanceDealLifecycle must be called with { type: 'banker', id: args.bankerId } so the lifecycle ledger event records the correct actor.",
  );
});

test("[lifecycle-event-guard-6] events.ts declares lifecycle_advance_attempted kind", () => {
  const body = read(EVENTS_PATH);
  assert.match(
    body,
    /lifecycle_advance_attempted\s*:\s*["']deal\.lifecycle\.advance_attempted["']/,
    "src/buddy/lifecycle/events.ts must export LedgerEventType.lifecycle_advance_attempted = 'deal.lifecycle.advance_attempted'.",
  );
  assert.match(
    body,
    /export\s+type\s+LifecycleAdvanceAttemptedPayload/,
    "events.ts must export LifecycleAdvanceAttemptedPayload type for downstream consumers.",
  );
});

test("[lifecycle-event-guard-7] submission writes advance_attempted event with snapshot_id", () => {
  const body = read(SUBMISSION_PATH);
  // The advance_attempted event must capture the snapshot id so future
  // debugging can correlate snapshot to attempted advance.
  assert.match(
    body,
    /snapshot_id\s*:\s*snapshotId/,
    "advance_attempted writeEvent input must include snapshot_id: snapshotId so audit trail links back to the snapshot.",
  );
});

test("[lifecycle-event-guard-8] submission orders advance BEFORE scheduleReadinessRefresh", () => {
  const body = read(SUBMISSION_PATH);
  const advanceIdx = body.search(
    /(?<![\w.])advanceDealLifecycle\s*\(\s*args\.dealId/,
  );
  const refreshIdx = body.search(/scheduleReadinessRefresh\s*\(/);
  assert.ok(
    advanceIdx > 0,
    "advanceDealLifecycle call site not found",
  );
  assert.ok(
    refreshIdx > 0,
    "scheduleReadinessRefresh call site not found",
  );
  assert.ok(
    advanceIdx < refreshIdx,
    "advanceDealLifecycle must run BEFORE scheduleReadinessRefresh: lifecycle event must fire synchronously and deterministically; readiness refresh is the fire-and-forget reconcile path.",
  );
});

// Note on [v11-6] compatibility:
//
// The [v11-6] CI guard at
// src/lib/deals/readiness/__tests__/perfectBankerFlowV11Guard.test.ts
// asserts submitCreditMemoToUnderwriting.ts contains
// scheduleReadinessRefresh|refreshDealReadiness. This guard must remain
// compatible with that one — i.e., we do NOT assert the absence of
// scheduleReadinessRefresh here. SR-2 of SPEC-FLOW-V1 PR3 inverted the
// original A-2 (which would have removed the call) precisely to keep
// these two guards in agreement. Future maintainers: if you add an
// assertion here that conflicts with [v11-6], stop and read the SR-2
// rationale at specs/banker-flow-v1/SPEC-FLOW-V1-PR3-lifecycle-advancement.md.
