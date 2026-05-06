/**
 * SPEC-13 — CreditMemoPanel link is readiness-aware.
 *
 * The panel renders one of two primary links:
 *   - When ready (missing_keys.length === 0):  "Open Memo" → /credit-memo
 *   - Otherwise:                              "Complete Memo Inputs" → /memo-inputs
 *
 * The panel is a client React component that returns a `links` array to
 * StatusListPanel. These tests verify the source-level branching is
 * present and points at the right hrefs/labels — matching the existing
 * journey test pattern of string-based file invariants.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "..", "CreditMemoPanel.tsx"),
  "utf8",
);

test("[credit-memo-panel-1] ready branch links to /credit-memo with 'Open Memo'", () => {
  // Look for the explicit ready arm: { label: "Open Memo", href: ... /credit-memo }
  assert.match(
    SOURCE,
    /label:\s*"Open Memo"[\s\S]{0,80}href:\s*`\/deals\/\$\{dealId\}\/credit-memo`/,
    "ready branch must label 'Open Memo' and point at /credit-memo",
  );
});

test("[credit-memo-panel-2] not-ready branch links to /memo-inputs with 'Complete Memo Inputs'", () => {
  assert.match(
    SOURCE,
    /label:\s*"Complete Memo Inputs"[\s\S]{0,80}href:\s*`\/deals\/\$\{dealId\}\/memo-inputs`/,
    "not-ready branch must label 'Complete Memo Inputs' and point at /memo-inputs",
  );
});

test("[credit-memo-panel-3] branch is conditional on isReady", () => {
  assert.match(SOURCE, /isReady/, "panel must compute and use an isReady flag");
  assert.match(
    SOURCE,
    /isReady[\s\S]{0,40}\?[\s\S]{0,400}:\s*\{[\s\S]{0,200}label:\s*"Complete Memo Inputs"/,
    "isReady ternary must drive the link object",
  );
});
