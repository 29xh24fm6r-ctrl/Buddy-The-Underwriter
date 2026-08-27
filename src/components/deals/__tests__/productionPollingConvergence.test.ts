import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const AUTO_INTELLIGENCE = join(
  REPO_ROOT,
  "src/lib/hooks/useAutoIntelligence.ts",
);
const PIPELINE = join(REPO_ROOT, "src/lib/pipeline/usePipelineState.ts");
const COCKPIT = join(REPO_ROOT, "src/buddy/cockpit/useCockpitData.tsx");
const PIPELINE_STATUS = join(
  REPO_ROOT,
  "src/components/deals/PipelineStatus.tsx",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("[polling-1] auto-intelligence polls recursively only for active runs", () => {
  const body = read(AUTO_INTELLIGENCE);
  assert.doesNotMatch(body, /setInterval\s*\(/);
  assert.match(body, /outcome === "active"/);
  assert.match(body, /status === "queued" \|\| status === "running"/);
  assert.match(body, /MAX_CONSECUTIVE_FAILURES/);
});

test("[polling-2] auto-intelligence suspends and aborts while hidden", () => {
  const body = read(AUTO_INTELLIGENCE);
  assert.match(body, /document\.visibilityState !== "visible"/);
  assert.match(body, /addEventListener\("visibilitychange"/);
  assert.match(body, /clearScheduledPoll\(\);\s*controllerRef\.current\?\.abort\(\)/);
});

test("[polling-3] pipeline polling suspends and aborts while hidden", () => {
  const body = read(PIPELINE);
  assert.match(body, /document\.visibilityState !== "visible"/);
  assert.match(body, /new AbortController\(\)/);
  assert.match(body, /clearScheduledPoll\(\);\s*controllerRef\.current\?\.abort\(\)/);
});

test("[polling-4] cockpit indicator reuses the provider's pipeline poller", () => {
  const cockpit = read(COCKPIT);
  const indicator = read(PIPELINE_STATUS);
  assert.match(cockpit, /pipeline:\s*PipelinePollingState/);
  assert.match(cockpit, /pipelineError:\s*string \| null/);
  assert.match(cockpit, /useOptionalCockpitDataContext/);
  assert.match(indicator, /usePipelineState\(cockpit \? null : dealId\)/);
  assert.match(indicator, /cockpit\?\.pipeline \?\? standalone\.pipeline/);
});
