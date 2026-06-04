import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — zero-net-function invariant.
 *
 * The source-snapshot write action is served by the existing consolidated
 * research/[action] dispatcher (SPEC-ROUTE-CONSOLIDATION-1), NOT a new app route
 * file — so the feature adds no serverless function (Buddy's Vercel
 * function-ceiling / "Deploying outputs" failure class). These are structural
 * guards over the route tree.
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const ROUTE_DIR = `${repoRoot}src/app/api/deals/[dealId]/research`;

test("[consolidation] NO standalone source-snapshot route file exists (no added function)", () => {
  assert.equal(
    existsSync(`${ROUTE_DIR}/committee-tasks/[taskId]/source-snapshot/route.ts`),
    false,
    "standalone source-snapshot route must not exist — it would add a serverless function",
  );
});

test("[consolidation] the only committee-tasks route is review (unchanged from main)", () => {
  assert.equal(existsSync(`${ROUTE_DIR}/committee-tasks/[taskId]/review/route.ts`), true);
});

test("[consolidation] dispatcher POST handles the 'source-snapshot' action", () => {
  const dispatcher = readFileSync(`${ROUTE_DIR}/[action]/route.ts`, "utf8");
  assert.match(dispatcher, /case "source-snapshot":/);
  assert.match(dispatcher, /_handlers\/sourceSnapshot/);
});

test("[consolidation] the consolidated handler exists with a POST export", () => {
  const handlerPath = `${ROUTE_DIR}/[action]/_handlers/sourceSnapshot.ts`;
  assert.equal(existsSync(handlerPath), true);
  const handler = readFileSync(handlerPath, "utf8");
  assert.match(handler, /export async function POST/);
  // Validation invariants preserved in the consolidated handler.
  assert.match(handler, /ensureDealBankAccess/);
  assert.match(handler, /taskId_required/);
  assert.match(handler, /isAllowedConnectorKind/);
  assert.match(handler, /isAllowedSourceType/);
  assert.match(handler, /\.eq\("deal_id", dealId\)/); // task belongs to deal
  // Never auto-clears committee: handler must not write committee_grade_accepted / review_status.
  assert.equal(/committee_grade_accepted\s*[:=]/.test(handler), false);
  assert.equal(/review_status\s*:/.test(handler), false);
});
