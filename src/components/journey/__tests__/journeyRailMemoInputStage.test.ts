/**
 * JourneyRail must include memo_inputs_required as a canonical stage.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const RAIL = join(REPO_ROOT, "src/components/journey/JourneyRail.tsx");
const ROUTES = join(REPO_ROOT, "src/components/journey/stageRoutes.ts");
const MODEL = join(REPO_ROOT, "src/buddy/lifecycle/model.ts");

function read(p: string) {
  return readFileSync(p, "utf8");
}

test("[rail-stage-1] JourneyRail CANONICAL_STAGES includes memo_inputs_required", () => {
  const body = read(RAIL);
  assert.match(
    body,
    /CANONICAL_STAGES[\s\S]*?"memo_inputs_required"/,
    "JourneyRail must include the memo_inputs_required stage in CANONICAL_STAGES",
  );
});

test("[rail-stage-2] stageRoutes maps memo_inputs_required to /memo-inputs", () => {
  const body = read(ROUTES);
  assert.match(
    body,
    /case\s+"memo_inputs_required"[\s\S]*?\/memo-inputs/,
    "stageCanonicalRoute must map memo_inputs_required to the memo-inputs page",
  );
});

test("[rail-stage-3] LifecycleStage union declares memo_inputs_required", () => {
  const body = read(MODEL);
  assert.match(
    body,
    /\|\s*"memo_inputs_required"/,
    "LifecycleStage union must declare memo_inputs_required",
  );
});

test("[rail-stage-4] STAGE_LABELS labels the new stage", () => {
  const body = read(MODEL);
  assert.match(
    body,
    /memo_inputs_required:\s*"Memo Inputs Required"/,
  );
});

test("[rail-stage-5] ALLOWED_STAGE_TRANSITIONS allows docs_satisfied → memo_inputs_required → underwrite_ready", () => {
  const body = read(MODEL);
  assert.match(
    body,
    /docs_satisfied:\s*\[[^\]]*"memo_inputs_required"/,
    "docs_satisfied must allow transition into memo_inputs_required",
  );
  assert.match(
    body,
    /memo_inputs_required:\s*\[[^\]]*"underwrite_ready"/,
    "memo_inputs_required must allow transition into underwrite_ready",
  );
});
