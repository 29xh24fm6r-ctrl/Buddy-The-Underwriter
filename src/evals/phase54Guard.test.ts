/**
 * Phase 54 — Eval Suite Guard Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Phase 54 — Eval Suite Guards", () => {
  it("migration exists with eval tables", () => {
    const content = readFileSync(join(root, "supabase/migrations/20260514_validation_and_eval.sql"), "utf-8");
    assert.ok(content.includes("buddy_eval_runs"));
    assert.ok(content.includes("buddy_eval_scores"));
  });

  it("golden dataset has 10 cases", () => {
    const content = readFileSync(join(root, "src/evals/cases/goldenCases.ts"), "utf-8");
    // Count case objects
    const matches = content.match(/id: "/g);
    assert.ok(matches && matches.length >= 10, `Expected 10+ cases, found ${matches?.length}`);
  });

  it("scorer uses no LLM for fact accuracy", () => {
    const content = readFileSync(join(root, "src/evals/scorer.ts"), "utf-8");
    assert.ok(!content.includes("gemini"), "scorer must not use Gemini for facts");
    assert.ok(!content.includes("callClaude"), "scorer must not use Claude for facts");
  });

  it("runner exists and exports runEvalSuite", () => {
    const content = readFileSync(join(root, "src/evals/runner.ts"), "utf-8");
    assert.ok(content.includes("runEvalSuite"));
  });

  it("eval run route is env-gated", () => {
    const content = readFileSync(join(root, "src/app/api/evals/run/route.ts"), "utf-8");
    assert.ok(content.includes("EVAL_DASHBOARD_ENABLED"));
  });

  it("eval dashboard page exists", () => {
    assert.ok(existsSync(join(root, "src/app/(app)/eval/page.tsx")));
  });

  it("no real deal data in golden cases", () => {
    const content = readFileSync(join(root, "src/evals/cases/goldenCases.ts"), "utf-8");
    assert.ok(!content.includes("Samaritus"), "no real company names in golden cases");
    assert.ok(content.includes("Synthetic") || content.includes("anonymized") || content.includes("synthetic"),
      "golden cases should note they are synthetic");
  });
});
