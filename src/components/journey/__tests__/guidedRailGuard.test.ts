/**
 * SPEC-GUIDED-STAGE-RAIL-1 — guided-rail source invariants (source-grep style).
 *
 * Pins the single-shot auto-advance behavior and the model-layer boundary so a
 * later edit can't turn the rail into an advance loop or reach into the model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const RAIL = join(REPO_ROOT, "src/components/journey/JourneyRail.tsx");
const HOOK = join(REPO_ROOT, "src/hooks/useAutoAdvance.ts");
const STEPS = join(REPO_ROOT, "src/lib/journey/stageSteps.ts");

function read(p: string) {
  return readFileSync(p, "utf8");
}

test("[guided-rail-1] JourneyRail calls useAutoAdvance exactly once", () => {
  const body = read(RAIL);
  const calls = body.match(/useAutoAdvance\(/g) ?? [];
  assert.equal(calls.length, 1, "useAutoAdvance must be invoked exactly once in JourneyRail");
});

test("[guided-rail-2] useAutoAdvance has the single-shot attempted guard", () => {
  assert.match(read(HOOK), /attempted\.current === key/);
});

test("[guided-rail-3] useAutoAdvance POSTs only to /lifecycle/advance, never force-advance", () => {
  const body = read(HOOK);
  assert.match(body, /\/lifecycle\/advance/, "must POST to the guarded advance route");
  assert.doesNotMatch(body, /force-advance/, "must never call force-advance");
  assert.doesNotMatch(body, /force['"\s:]/, "must never pass force in the request body");
});

test("[guided-rail-4] stageSteps imports only from the model layer contract (never the patient)", () => {
  const body = read(STEPS);
  const imports = [...body.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const allowed = new Set([
    "@/buddy/lifecycle/model",
    "@/buddy/lifecycle/blockerToStage",
    "@/buddy/lifecycle/nextAction",
    "@/lib/journey/journeyActionProjection",
  ]);
  for (const imp of imports) {
    assert.ok(allowed.has(imp), `stageSteps must not import from ${imp}`);
  }
  // Explicitly forbid the out-of-scope model internals.
  assert.doesNotMatch(body, /deriveLifecycleState|computeBlockers/);
});
