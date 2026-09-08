/**
 * Fact reconciliation must run under the same grant as the readiness build
 * that invokes it. Worker paths (doc extraction, research completion, the
 * readiness reconcile sweep) have no Clerk session; on 2026-09-08 every
 * worker-driven refresh logged "[ensureDealBankAccess] unauthorized: no
 * userId" from reconcileDealFacts and silently skipped conflict detection.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const RECONCILER = readFileSync(
  join(REPO_ROOT, "src/lib/creditMemo/inputs/reconcileDealFacts.ts"),
  "utf8",
);
const BUILDER = readFileSync(
  join(REPO_ROOT, "src/lib/creditMemo/inputs/buildMemoInputPackage.ts"),
  "utf8",
);

test("reconcileDealFacts accepts a delegated grant and verifies it", () => {
  assert.match(RECONCILER, /accessGrant\?: DealBankAccessGrant/);
  assert.match(
    RECONCILER,
    /isDealBankAccessGrantFor\(delegated, args\.dealId, delegated\.bankId\)/,
  );
});

test("buildMemoInputPackage forwards its grant to reconcileDealFacts", () => {
  assert.match(
    BUILDER,
    /reconcileDealFacts\(\{\s*dealId: args\.dealId,\s*accessGrant: grant,\s*\}\)/,
  );
});

test("a skipped reconciliation is logged, not swallowed", () => {
  assert.match(BUILDER, /fact reconciliation skipped dealId=/);
});
