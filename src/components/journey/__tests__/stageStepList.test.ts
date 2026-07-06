/**
 * SPEC-GUIDED-STAGE-RAIL-1 — StageStepList source invariants (source-grep style,
 * matching the existing convention in this folder).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const STEP_LIST = join(REPO_ROOT, "src/components/journey/StageStepList.tsx");

function read(p: string) {
  return readFileSync(p, "utf8");
}

test("[step-list-1] StageStepList exposes the stage-step-list test id", () => {
  assert.match(read(STEP_LIST), /data-testid="stage-step-list"/);
});

test("[step-list-2] resolved steps render green (emerald) with a strikethrough", () => {
  const body = read(STEP_LIST);
  assert.match(body, /line-through/, "resolved steps must use line-through");
  assert.match(body, /emerald/, "resolved steps must use an emerald color token");
});

test("[step-list-3] StageStepList does not import from deriveLifecycleState (model layer untouched)", () => {
  assert.doesNotMatch(read(STEP_LIST), /deriveLifecycleState/);
});

test("[step-list-4] system-computed open steps render as passive dimmed status rows", () => {
  const body = read(STEP_LIST);
  assert.match(body, /s\.open && s\.system/, "system-owned open steps must branch before clickable links");
  assert.match(body, /animate-pulse/, "system-owned open steps must show a pulsing indicator");
  assert.match(body, /italic/, "system-owned open steps must render in italic");
});
