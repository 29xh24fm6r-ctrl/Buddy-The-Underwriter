/**
 * Credit memo redirect guard.
 *
 * Verifies that the /deals/[dealId]/credit-memo page:
 *   1. Imports buildMemoInputPackage so it can evaluate readiness server-side
 *   2. Renders the inline MemoInputsRedirectBanner + MemoInputsBody when
 *      readiness is incomplete and no banker_submitted snapshot exists
 *      (SPEC-13 replaced the silent redirect() with a visible banner —
 *      see SPEC-13 comment in the page itself).
 *   3. Allows render when a submitted snapshot exists (banker re-views)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// __dirname is src/app/(app)/deals/[dealId]/credit-memo/__tests__ —
// 7 levels below repo root (__tests__, credit-memo, [dealId], deals,
// (app), app, src). Previous version had 6 `..`s and resolved to `src/`,
// causing readFileSync to look at `src/src/...` and ENOENT on CI.
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..", "..");
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

test("[memo-redirect-2] page renders MemoInputsRedirectBanner + MemoInputsBody when readiness blocked", () => {
  // SPEC-13 changed this branch from a hard `redirect(/memo-inputs)` to an
  // inline banner + body render so the banker can see *why* the URL
  // changed instead of being silently bounced. The new contract: when
  // readiness is not ready (and no submitted snapshot exists), the page
  // returns JSX containing <MemoInputsRedirectBanner /> and
  // <MemoInputsBody />. We assert both renders, gated by a readiness.ready
  // check that precedes them in source order.
  const body = read();
  assert.match(
    body,
    /readiness\.ready[\s\S]*?<MemoInputsRedirectBanner\b/,
    "Page must render <MemoInputsRedirectBanner /> when readiness is incomplete",
  );
  assert.match(
    body,
    /<MemoInputsBody\b/,
    "Page must render <MemoInputsBody /> inline (not redirect) when readiness is incomplete",
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
