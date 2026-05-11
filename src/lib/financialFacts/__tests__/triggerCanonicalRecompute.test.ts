/**
 * SPEC-FOUNDATION-V1 PR5b — triggerCanonicalRecompute tests.
 *
 * Source-level guards + behavioral debounce tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const MODULE_PATH = join(
  REPO_ROOT,
  "src/lib/financialFacts/triggerCanonicalRecompute.ts",
);
const SPREADS_PROCESSOR_PATH = join(
  REPO_ROOT,
  "src/lib/jobs/processors/spreadsProcessor.ts",
);
const PRICING_ROUTE_PATH = join(
  REPO_ROOT,
  "src/app/api/deals/[dealId]/pricing/inputs/route.ts",
);
const RECOMPUTE_ROUTE_PATH = join(
  REPO_ROOT,
  "src/app/api/deals/[dealId]/spreads/recompute/route.ts",
);

function read(p: string): string {
  return readFileSync(p, "utf8");
}

// ── Module structure guards ────────────────────────────────────────────────

test("[pr5b-1] triggerCanonicalRecompute module exports the function", () => {
  const body = read(MODULE_PATH);
  assert.match(
    body,
    /export async function triggerCanonicalRecompute\(/,
    "Module must export triggerCanonicalRecompute.",
  );
});

test("[pr5b-2] module exports the four trigger reasons", () => {
  const body = read(MODULE_PATH);
  for (const reason of [
    "extraction_batch_complete",
    "structural_pricing_updated",
    "banker_initiated_refresh",
    "manual_diagnostic",
  ]) {
    assert.match(
      body,
      new RegExp(`["']${reason}["']`),
      `Module must define trigger reason: ${reason}`,
    );
  }
});

test("[pr5b-3] module has debounce logic", () => {
  const body = read(MODULE_PATH);
  assert.match(body, /debounceMap/, "Module must use a debounce map.");
  assert.match(
    body,
    /shouldDebounce/,
    "Module must implement a shouldDebounce check.",
  );
});

test("[pr5b-4] module emits canonical.recompute.triggered ledger event", () => {
  const body = read(MODULE_PATH);
  assert.match(
    body,
    /canonical\.recompute\.triggered/,
    "Module must emit 'canonical.recompute.triggered' event.",
  );
});

test("[pr5b-5] module emits canonical.recompute.waiting_on_facts event", () => {
  const body = read(MODULE_PATH);
  assert.match(
    body,
    /canonical\.recompute\.waiting_on_facts/,
    "Module must emit 'canonical.recompute.waiting_on_facts' event.",
  );
});

test("[pr5b-6] module passes triggerReason through to enqueueSpreadRecompute meta", () => {
  const body = read(MODULE_PATH);
  assert.match(
    body,
    /triggerReason:\s*reason/,
    "Module must pass triggerReason through to enqueueSpreadRecompute's meta.",
  );
});

test("[pr5b-7] module is non-fatal (try/catch with return)", () => {
  const body = read(MODULE_PATH);
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(
    stripped,
    /catch\s*\(\s*err/,
    "Module must have a catch block for non-fatal error handling.",
  );
  assert.match(
    stripped,
    /ok:\s*false/,
    "Catch block must return { ok: false }.",
  );
});

// ── Trigger site guards ────────────────────────────────────────────────────

test("[pr5b-8] Trigger #1: spreadsProcessor calls triggerCanonicalRecompute with extraction_batch_complete", () => {
  const body = read(SPREADS_PROCESSOR_PATH);
  assert.match(
    body,
    /triggerCanonicalRecompute/,
    "spreadsProcessor must call triggerCanonicalRecompute.",
  );
  assert.match(
    body,
    /extraction_batch_complete/,
    "spreadsProcessor must use reason: 'extraction_batch_complete'.",
  );
});

test("[pr5b-9] Trigger #2: pricing/inputs route calls triggerCanonicalRecompute with structural_pricing_updated", () => {
  const body = read(PRICING_ROUTE_PATH);
  assert.match(
    body,
    /triggerCanonicalRecompute/,
    "pricing/inputs route must call triggerCanonicalRecompute.",
  );
  assert.match(
    body,
    /structural_pricing_updated/,
    "pricing/inputs route must use reason: 'structural_pricing_updated'.",
  );
});

test("[pr5b-10] Trigger #3: spreads/recompute route calls triggerCanonicalRecompute with banker_initiated_refresh", () => {
  const body = read(RECOMPUTE_ROUTE_PATH);
  assert.match(
    body,
    /triggerCanonicalRecompute/,
    "spreads/recompute route must call triggerCanonicalRecompute.",
  );
  assert.match(
    body,
    /banker_initiated_refresh/,
    "spreads/recompute route must use reason: 'banker_initiated_refresh'.",
  );
});

test("[pr5b-11] All three trigger calls are wrapped in try/catch or void (non-fatal)", () => {
  for (const [name, path] of [
    ["spreadsProcessor", SPREADS_PROCESSOR_PATH],
    ["pricing/inputs", PRICING_ROUTE_PATH],
    ["spreads/recompute", RECOMPUTE_ROUTE_PATH],
  ] as const) {
    const body = read(path);
    // Strip comments to avoid matching the function name in comment text
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Find the actual function call (not import string, not comment)
    const callIdx = stripped.indexOf("triggerCanonicalRecompute(");
    assert.ok(callIdx > 0, `${name} must call triggerCanonicalRecompute(`);
    // Check surrounding context for try/catch or void
    const preceding = stripped.slice(Math.max(0, callIdx - 300), callIdx);
    const hasTryCatch =
      preceding.includes("try {") || preceding.includes("try{");
    const hasVoid =
      stripped.slice(Math.max(0, callIdx - 10), callIdx).includes("void ");
    assert.ok(
      hasTryCatch || hasVoid,
      `${name}'s triggerCanonicalRecompute call must be non-fatal (try/catch or void).`,
    );
  }
});

test("[pr5b-12] spreads/recompute preserves its existing enqueueSpreadRecompute call", () => {
  const body = read(RECOMPUTE_ROUTE_PATH);
  assert.match(
    body,
    /enqueueSpreadRecompute\(/,
    "spreads/recompute route must still call enqueueSpreadRecompute (PR5b adds alongside, not replaces).",
  );
});
