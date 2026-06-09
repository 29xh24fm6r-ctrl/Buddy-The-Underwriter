import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — zero-net-function invariant.
 *
 * The committee-task write actions (source-snapshot attach + review) are served
 * by the existing consolidated research/[action] dispatcher
 * (SPEC-ROUTE-CONSOLIDATION-1), NOT standalone app route files — so research/
 * keeps exactly ONE route.ts and the feature adds no serverless function
 * (Buddy's Vercel function-ceiling / "Deploying outputs" failure class). These
 * are structural guards over the route tree.
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const RESEARCH_DIR = `${repoRoot}src/app/api/deals/[dealId]/research`;

test("[consolidation] no standalone committee-tasks routes exist (no added functions)", () => {
  assert.equal(
    existsSync(`${RESEARCH_DIR}/committee-tasks`),
    false,
    "committee-tasks/ route tree must not exist — its actions are consolidated into [action]",
  );
});

test("[consolidation] research/ exposes exactly one route.ts (the [action] dispatcher)", () => {
  assert.equal(existsSync(`${RESEARCH_DIR}/[action]/route.ts`), true);
});

test("[consolidation] dispatcher routes source-snapshot (POST) and committee-task-review (PATCH)", () => {
  const dispatcher = readFileSync(`${RESEARCH_DIR}/[action]/route.ts`, "utf8");
  assert.match(dispatcher, /case "source-snapshot":/);
  assert.match(dispatcher, /_handlers\/sourceSnapshot/);
  assert.match(dispatcher, /export async function PATCH/);
  assert.match(dispatcher, /case "committee-task-review":/);
  assert.match(dispatcher, /_handlers\/committeeTaskReview/);
});

function assertHandlerInvariants(handler: string) {
  assert.match(handler, /export async function (POST|PATCH)/);
  assert.match(handler, /ensureDealBankAccess/);
  assert.match(handler, /taskId_required/);
  assert.match(handler, /\.eq\("deal_id", dealId\)/); // task belongs to deal
  // Never auto-clears committee: handler must not WRITE committee_grade_accepted
  // or review_status as object keys (selecting them in a string is fine).
  assert.equal(/committee_grade_accepted\s*[:=]/.test(handler), false);
}

test("[consolidation] source-snapshot handler preserves validation invariants", () => {
  const handler = readFileSync(`${RESEARCH_DIR}/[action]/_handlers/sourceSnapshot.ts`, "utf8");
  assertHandlerInvariants(handler);
  assert.match(handler, /isAllowedConnectorKind/);
  assert.match(handler, /isAllowedSourceType/);
});

test("[consolidation] committee-task-review handler preserves validation invariants", () => {
  const handler = readFileSync(`${RESEARCH_DIR}/[action]/_handlers/committeeTaskReview.ts`, "utf8");
  assertHandlerInvariants(handler);
  assert.match(handler, /isCommitteeReviewAction/);
});

// SPEC-BIE-ACTIVE-SOURCE-COLLECTION-PR-B: industry source collection is a new
// dispatcher ACTION (zero net functions) and never auto-clears committee.
test("[consolidation] dispatcher routes collect-industry-source (POST)", () => {
  const dispatcher = readFileSync(`${RESEARCH_DIR}/[action]/route.ts`, "utf8");
  assert.match(dispatcher, /case "collect-industry-source":/);
  assert.match(dispatcher, /_handlers\/collectIndustrySource/);
});

test("[consolidation] collect-industry-source handler invariants (deterministic, no committee_grade write)", () => {
  const handler = readFileSync(`${RESEARCH_DIR}/[action]/_handlers/collectIndustrySource.ts`, "utf8");
  assert.match(handler, /export async function POST/);
  assert.match(handler, /ensureDealBankAccess/);
  assert.match(handler, /buildIndustrySourceDescriptor/); // deterministic source only
  assert.match(handler, /persistManualSourceSnapshot/);   // reuses the safe persist-core
  assert.match(handler, /resolved_status.*needs_review/s); // analyst review required
  // BUGFIX-INDUSTRY-COLLECTOR-LIVE-EXECUTION-1: robust to DUPLICATE industry tasks
  // (selects all + idempotent already_collected; no nondeterministic single pick).
  assert.match(handler, /already_collected/);
  assert.match(handler, /source_snapshot_id/);
  // INVARIANT: never writes committee_grade_accepted (no auto-clear).
  assert.equal(/committee_grade_accepted\s*[:=]/.test(handler), false);
});

test("[consolidation] research/ still exposes exactly one route.ts after PR-B (no added function)", () => {
  assert.equal(existsSync(`${RESEARCH_DIR}/collect-industry-source`), false);
  assert.equal(existsSync(`${RESEARCH_DIR}/[action]/route.ts`), true);
});
