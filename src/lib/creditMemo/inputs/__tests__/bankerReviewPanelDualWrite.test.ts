// SPEC-13.5 PR-B B-3 + B-2 — guard tests for the BankerReviewPanel
// dual-write rewire AND the MemoCompletionWizard stale-comment removal.
//
// These pin source patterns so a future refactor can't accidentally
// route a canonical field to the deprecation shim or vice versa.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const BRP_PATH = path.join(
  process.cwd(),
  "src/components/creditMemo/BankerReviewPanel.tsx",
);
const WIZARD_PATH = path.join(
  process.cwd(),
  "src/components/creditMemo/MemoCompletionWizard.tsx",
);
const BRP = fs.readFileSync(BRP_PATH, "utf-8");
const WIZARD = fs.readFileSync(WIZARD_PATH, "utf-8");

// ── B-3: BankerReviewPanel dual-write ─────────────────────────────────

test("[brp.dualWrite-1] imports routePartition + helpers from canonical module", () => {
  assert.match(
    BRP,
    /import\s*\{[\s\S]*?routePartition[\s\S]*?\}\s*from\s*["']@\/lib\/creditMemo\/inputs\/routePartition["']/,
    "BankerReviewPanel must import routePartition from the canonical helper module",
  );
  assert.match(
    BRP,
    /flattenCanonicalForFromWizard/,
    "must use flattenCanonicalForFromWizard helper to build the wire payload",
  );
});

test("[brp.dualWrite-2] saveOverrides calls routePartition", () => {
  // Sanity: the partition step happens inside saveOverrides.
  const saveOverridesIdx = BRP.indexOf("const saveOverrides = useCallback");
  assert.ok(saveOverridesIdx > 0, "saveOverrides callback must exist");
  const callbackBody = BRP.slice(saveOverridesIdx, saveOverridesIdx + 3000);
  assert.match(callbackBody, /routePartition\(/);
});

test("[brp.dualWrite-3] canonical fields POST to /memo-inputs with kind: from-wizard", () => {
  const saveOverridesIdx = BRP.indexOf("const saveOverrides = useCallback");
  const callbackBody = BRP.slice(saveOverridesIdx, saveOverridesIdx + 3000);
  // The canonical write must hit /memo-inputs with the from-wizard discriminator.
  assert.match(callbackBody, /\/api\/deals\/\$\{dealId\}\/memo-inputs/);
  assert.match(callbackBody, /kind:\s*["']from-wizard["']/);
});

test("[brp.dualWrite-4] UI-state fields POST to legacy /credit-memo/overrides shim", () => {
  const saveOverridesIdx = BRP.indexOf("const saveOverrides = useCallback");
  const callbackBody = BRP.slice(saveOverridesIdx, saveOverridesIdx + 3000);
  // The UI-state write still hits the legacy URL — the shim no-ops + telemetry-pings.
  assert.match(callbackBody, /\/api\/deals\/\$\{dealId\}\/credit-memo\/overrides/);
});

test("[brp.dualWrite-5] both writes can run in parallel via Promise.all", () => {
  const saveOverridesIdx = BRP.indexOf("const saveOverrides = useCallback");
  const callbackBody = BRP.slice(saveOverridesIdx, saveOverridesIdx + 3000);
  // Promise.all ensures both writes start simultaneously rather than
  // sequentially. Either Promise.all or Promise.allSettled is acceptable.
  assert.match(
    callbackBody,
    /Promise\.(all|allSettled)\(/,
    "saveOverrides must dispatch the two writes in parallel",
  );
});

test("[brp.dualWrite-6] gating helpers prevent empty POSTs", () => {
  const saveOverridesIdx = BRP.indexOf("const saveOverrides = useCallback");
  const callbackBody = BRP.slice(saveOverridesIdx, saveOverridesIdx + 3000);
  // Skip the canonical write when there are no canonical fields to send;
  // skip the UI-state write when there are no UI-state fields. Saves a
  // round-trip for tab-only patches and avoids a wizard_save event with
  // empty payload_keys.
  assert.match(callbackBody, /hasAnyCanonicalField\(/);
  assert.match(callbackBody, /hasAnyUIStateField\(/);
});

test("[brp.dualWrite-7] Option A consequence is documented inline", () => {
  // Per the spec amendment: SPEC-13.5 Option A — UI-state writes don't
  // persist after PR-B. The component must reference the follow-up doc
  // so a future dev can find the explanation without spelunking.
  assert.match(
    BRP,
    /SPEC-13\.5/,
    "BankerReviewPanel must reference SPEC-13.5 in a comment near saveOverrides",
  );
  assert.ok(
    BRP.includes("Option A") || BRP.includes("does NOT persist") ||
      BRP.includes("telemetry-pings"),
    "comment must convey Option A's UI-state non-persistence semantics",
  );
});

// ── B-2: MemoCompletionWizard ─────────────────────────────────────────

test("[wizard.b2-1] wizard POSTs to /memo-inputs (not the deprecated shim)", () => {
  // The wizard's save() function POSTs to the canonical endpoint with
  // kind: "from-wizard". This was already true before PR-B but the
  // forward-referencing comment is removed by B-2.
  const saveIdx = WIZARD.indexOf("const save = async ()");
  assert.ok(saveIdx > 0, "wizard's save function must exist");
  const saveBody = WIZARD.slice(saveIdx, saveIdx + 1500);
  assert.match(saveBody, /\/api\/deals\/\$\{dealId\}\/memo-inputs/);
  assert.match(saveBody, /kind:\s*["']from-wizard["']/);
});

test("[wizard.b2-2] stale 'deprecation no-op shim' comment removed", () => {
  // The forward-referencing comment ('/credit-memo/overrides POST is now
  // a deprecation no-op shim') was removed by B-2 since (a) the wizard
  // doesn't POST to that URL anyway, and (b) the comment was originally
  // forward-referencing PR-B's rewire that didn't land.
  assert.ok(
    !WIZARD.includes("/credit-memo/overrides POST is now a deprecation no-op shim"),
    "stale forward-reference comment must be removed",
  );
});

test("[wizard.b2-3] GET to /credit-memo/overrides preserved (legacy data prefill)", () => {
  // The wizard still GETs from the legacy URL on open() to prefill any
  // existing override content. Legacy GET stays functional per the spec
  // (only POST is shimmed).
  assert.match(
    WIZARD,
    /fetch\(`\/api\/deals\/\$\{dealId\}\/credit-memo\/overrides`\)/,
    "wizard must keep its GET to legacy /credit-memo/overrides for prefill",
  );
});
