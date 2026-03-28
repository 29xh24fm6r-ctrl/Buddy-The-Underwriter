import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Test 1: Every BuddyActionCode has a mapping ─────────────
test("every BuddyActionCode has a mapping in CANONICAL_ACTION_EXECUTION_MAP", () => {
  const typesContent = fs.readFileSync(
    path.resolve(root, "src/core/actions/types.ts"),
    "utf8",
  );
  const mapContent = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/canonicalActionExecutionMap.ts"),
    "utf8",
  );

  const actionCodeBlock =
    typesContent.match(/export type BuddyActionCode\s*=([\s\S]*?);/)?.[1] ?? "";
  const codeMatches = actionCodeBlock.match(/"\w+"/g) ?? [];
  const codes = codeMatches.map((m) => m.replace(/"/g, ""));

  assert.ok(codes.length > 0, "Should find at least one action code");

  for (const code of codes) {
    assert.ok(
      mapContent.includes(`${code}:`),
      `Missing mapping for action code: ${code}`,
    );
  }
});

// ── Test 2: No unknown execution modes ───────────────────────
test("no unknown execution modes in map", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/canonicalActionExecutionMap.ts"),
    "utf8",
  );

  const validModes = ["direct_write", "queue_job", "task_only", "noop"];
  const modeMatches = content.match(/mode: "(\w+)"/g) ?? [];

  for (const m of modeMatches) {
    const mode = m.match(/"(\w+)"/)?.[1];
    assert.ok(
      mode && validModes.includes(mode),
      `Unknown execution mode: ${mode}`,
    );
  }
});

// ── Test 3: No missing targets ───────────────────────────────
test("no missing or empty targets in map", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/canonicalActionExecutionMap.ts"),
    "utf8",
  );

  const validTargets = [
    "conditions", "covenants", "reporting", "monitoring",
    "financial_snapshot", "pricing", "memo", "committee",
    "closing", "workflow", "unknown",
  ];
  const targetMatches = content.match(/target: "(\w+)"/g) ?? [];

  assert.ok(targetMatches.length > 0, "Should have target entries");

  for (const t of targetMatches) {
    const target = t.match(/"(\w+)"/)?.[1];
    assert.ok(
      target && validTargets.includes(target),
      `Unknown target: ${target}`,
    );
  }
});

// ── Test 4: Map type is Record<BuddyActionCode, ...> ─────────
test("map is typed as Record<BuddyActionCode, ...> for exhaustiveness", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/canonicalActionExecutionMap.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("Record<\n  BuddyActionCode") || content.includes("Record<BuddyActionCode"),
    "Map must be typed as Record<BuddyActionCode, ...> for compile-time exhaustiveness",
  );
});
