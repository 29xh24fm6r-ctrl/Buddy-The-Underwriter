/**
 * Credit memo redirect guard.
 *
 * Verifies that the /deals/[dealId]/credit-memo page:
 *   1. Imports buildMemoInputPackage so it can evaluate readiness server-side
 *   2. Redirects to /memo-inputs when readiness is incomplete and no
 *      banker_submitted snapshot exists
 *   3. Allows render when a submitted snapshot exists (banker re-views)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");
const PAGE = join(
  REPO_ROOT,
  "src/app/(app)/deals/[dealId]/credit-memo/page.tsx",
);

function read() {
  return readFileSync(PAGE, "utf8");
}

test("[memo-redirect-1] page imports buildMemoInputPackage", () => {
  const body = read();
  assert.match(
    body,
    /import\s*\{\s*buildMemoInputPackage\s*\}\s*from\s+["']@\/lib\/creditMemo\/inputs\/buildMemoInputPackage["']/,
  );
});

test("[memo-redirect-2] page redirects to /memo-inputs when readiness blocked", () => {
  const body = read();
  assert.match(
    body,
    /readiness\.ready[\s\S]*?redirect\(`\/deals\/\$\{dealId\}\/memo-inputs`\)/,
    "Page must redirect to /memo-inputs when readiness is incomplete",
  );
});

test("[memo-redirect-3] page allows render when banker_submitted snapshot exists", () => {
  const body = read();
  assert.match(
    body,
    /hasSubmittedSnapshot/,
    "Page must check for hasSubmittedSnapshot before triggering redirect",
  );
  assert.match(
    body,
    /banker_submitted/,
    "Submitted-snapshot detection must reference the banker_submitted status",
  );
});
