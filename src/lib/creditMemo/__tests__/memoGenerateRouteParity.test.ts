/**
 * SPEC-FINENGINE-MEMO-GATE-PARITY-1 — V1 no-drift route-structure guard.
 *
 * Structural assertions over the generate route source: BOTH the finengine and
 * legacy branches must enforce the two renderer-independent gates through the
 * single shared helper (no re-inlined trust/validation logic that could drift),
 * the finengine branch must NOT reference ai_risk_runs (it supersedes that
 * legacy-only require with its own riskRating), and the ai_risk_runs hard-require
 * must remain in the legacy branch.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(process.cwd(), "src/app/api/deals/[dealId]/credit-memo/generate/route.ts");
const src = readFileSync(ROUTE, "utf8");

// Isolate the finengine branch (from its `=== "finengine"` guard to its closing
// `source: "finengine", gate:` success return) from the legacy body that follows,
// so we can reason about each independently. The slice deliberately excludes the
// file header docblock, which legitimately documents the legacy ai_risk_runs require.
const finengineBranchStart = src.indexOf('=== "finengine"');
const finengineBranchEnd = src.indexOf('source: "finengine", gate:');
assert.ok(finengineBranchStart > 0, "finengine branch guard should exist");
assert.ok(finengineBranchEnd > finengineBranchStart, "finengine branch return should exist");
const finengineBranch = src.slice(finengineBranchStart, finengineBranchEnd);
const legacyBody = src.slice(finengineBranchEnd);

test("the shared precondition helper is imported", () => {
  assert.match(
    src,
    /import\s*\{\s*enforceMemoGenerationPreconditions\s*\}\s*from\s*["']@\/lib\/creditMemo\/memoGenerationPreconditions["']/,
  );
});

test("BOTH branches call enforceMemoGenerationPreconditions (single source of truth, no drift)", () => {
  const calls = src.match(/enforceMemoGenerationPreconditions\(/g) ?? [];
  assert.ok(calls.length >= 2, `expected ≥2 call sites (finengine + legacy), found ${calls.length}`);
  assert.match(finengineBranch, /enforceMemoGenerationPreconditions\(/, "finengine branch must call the helper");
  assert.match(legacyBody, /enforceMemoGenerationPreconditions\(/, "legacy branch must call the helper");
});

test("the inline trust/validation gate logic is NOT re-inlined anywhere (it lives only in the helper)", () => {
  // The route must not duplicate the gate logic the helper now owns.
  assert.doesNotMatch(src, /loadAndEnforceResearchTrust\(/, "research-trust enforcement must go through the helper, not be re-inlined");
  assert.doesNotMatch(
    src,
    /gating_decision\s*===\s*["']BLOCK_GENERATION["']/,
    "validation BLOCK_GENERATION comparison must live in the helper, not the route",
  );
});

test("the finengine branch does NOT reference ai_risk_runs (the engine supersedes it with riskRating)", () => {
  assert.doesNotMatch(finengineBranch, /ai_risk_runs/, "finengine branch must not require an ai_risk_run");
});

test("the ai_risk_runs hard-require remains in the legacy branch (legacy-only by design)", () => {
  assert.match(legacyBody, /ai_risk_runs/, "legacy branch must keep the ai_risk_runs hard-require");
  assert.match(legacyBody, /AI risk assessment required/, "legacy branch keeps its risk-run error message");
});
