import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

const source = fs.readFileSync(
  path.join(repoRoot, "src/lib/classicSpread/classicSpreadRenderer.ts"),
  "utf8",
);

// ---------------------------------------------------------------------------
// SPEC-CLASSIC-SPREAD-5COL-LAYOUT-1 guard tests
// ---------------------------------------------------------------------------

test("computeLayout returns narrower widths when periodCount >= 5", () => {
  // The function must exist and check periodCount >= 5
  assert.match(source, /function computeLayout/);
  assert.match(source, /periodCount\s*>=\s*5/);
  // 5-col layout: label 140, value 52, pct 26
  assert.match(source, /label:\s*140/);
  assert.match(source, /value:\s*52/);
  assert.match(source, /pct:\s*26/);
});

test("computeLayout returns standard widths when periodCount < 5", () => {
  // 4-col layout: label 165, value 60, pct 30
  assert.match(source, /label:\s*165/);
  assert.match(source, /value:\s*60/);
  assert.match(source, /pct:\s*30/);
});

test("DocState includes layout field", () => {
  assert.match(source, /layout:\s*LayoutConfig/);
});

test("DocState is initialized with computeLayout(periods.length)", () => {
  assert.match(source, /computeLayout\(periods\.length\)/);
});
