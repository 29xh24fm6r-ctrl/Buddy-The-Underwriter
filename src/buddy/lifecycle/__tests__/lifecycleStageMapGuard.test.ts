import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);
const source = fs.readFileSync(
  path.join(repoRoot, "src/buddy/lifecycle/deriveLifecycleState.ts"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Guard: mapToUnifiedStage must handle decision_made, closing, closed
// (SPEC-LIFECYCLE-STAGE-MAP-1)
// ---------------------------------------------------------------------------

test('mapToUnifiedStage handles "decision_made" → committee_decisioned', () => {
  assert.match(source, /case\s+["']decision_made["']/);
  // The case body must return committee_decisioned
  const idx = source.indexOf('case "decision_made"');
  const snippet = source.slice(idx, idx + 200);
  assert.match(snippet, /committee_decisioned/);
});

test('mapToUnifiedStage handles "closing" → closing_in_progress', () => {
  assert.match(source, /case\s+["']closing["']/);
  const idx = source.indexOf('case "closing"');
  const snippet = source.slice(idx, idx + 200);
  assert.match(snippet, /closing_in_progress/);
});

test('mapToUnifiedStage handles "closed" → closed', () => {
  // There's a case "closed" in the switch
  const switchBlock = source.slice(source.indexOf("switch (lifecycleStage)"));
  assert.match(switchBlock, /case\s+["']closed["']/);
  const idx = switchBlock.indexOf('case "closed"');
  const snippet = switchBlock.slice(idx, idx + 200);
  assert.match(snippet, /return\s+["']closed["']/);
});

test("DealLifecycleStage type includes decision_made, closing, closed", () => {
  const typeLine = source
    .split("\n")
    .find((l) => l.includes("type DealLifecycleStage"));
  assert.ok(typeLine, "DealLifecycleStage type not found");
  assert.match(typeLine!, /decision_made/);
  assert.match(typeLine!, /closing/);
  assert.match(typeLine!, /closed/);
});
