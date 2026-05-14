import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(
  process.cwd(),
  "src/lib/workers/processPulseOutbox.ts",
);
const SRC = readFileSync(FILE, "utf8");

test("[pulse-allowlist-1] PULSE_KINDS allowlist is defined as a Set", () => {
  assert.match(
    SRC,
    /const\s+PULSE_KINDS\s*=\s*new\s+Set(?:<[^>]*>)?\s*\(\s*\[/,
    "PULSE_KINDS must be a Set",
  );
});

test("[pulse-allowlist-2] PULSE_KINDS includes the four documented telemetry kinds", () => {
  assert.match(SRC, /"checklist_reconciled"/);
  assert.match(SRC, /"readiness_recomputed"/);
  assert.match(SRC, /"artifact_processed"/);
  assert.match(SRC, /"manual_override"/);
});

test("[pulse-allowlist-3] PULSE_KINDS does NOT include doc.extract or intake.process", () => {
  const setMatch = SRC.match(/const\s+PULSE_KINDS\s*=\s*new\s+Set(?:<[^>]*>)?\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(setMatch, "PULSE_KINDS set definition not found");
  const body = setMatch[1];
  assert.doesNotMatch(body, /"doc\.extract"/);
  assert.doesNotMatch(body, /"intake\.process"/);
});

test("[pulse-allowlist-4] idle probe uses includeKinds, NOT excludeKinds", () => {
  assert.match(SRC, /hasOutboxWork\(\s*\{[^}]*includeKinds:\s*PULSE_KINDS_LIST/);
  assert.doesNotMatch(SRC, /hasOutboxWork\(\s*\{[^}]*excludeKinds:/);
});

test("[pulse-allowlist-5] candidate select filters with .in('kind', PULSE_KINDS_LIST)", () => {
  assert.match(SRC, /\.in\(\s*["']kind["']\s*,\s*PULSE_KINDS_LIST\s*\)/);
});

test("[pulse-allowlist-6] no legacy INTAKE_KINDS denylist remains", () => {
  assert.doesNotMatch(SRC, /\bINTAKE_KINDS\b/);
});

test("[pulse-allowlist-7] post-fetch filter uses PULSE_KINDS.has, not negation", () => {
  assert.match(SRC, /PULSE_KINDS\.has\(\s*r\.kind\s*\)/);
});
