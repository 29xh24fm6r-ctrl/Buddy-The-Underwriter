/**
 * Phase 53 — Validation Pass Guard Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Phase 53 — BVP Guards", () => {
  it("migration exists with buddy_validation_reports", () => {
    const p = join(root, "supabase/migrations/20260514_validation_and_eval.sql");
    assert.ok(existsSync(p));
    assert.ok(readFileSync(p, "utf-8").includes("buddy_validation_reports"));
  });

  it("mathematical checks are pure (no server-only import)", () => {
    const content = readFileSync(join(root, "src/lib/validation/mathematicalChecks.ts"), "utf-8");
    assert.ok(!content.includes("server-only"), "mathematical checks must be pure");
    assert.ok(!content.includes("supabaseAdmin"), "no DB in math checks");
  });

  it("completeness checks are pure", () => {
    const content = readFileSync(join(root, "src/lib/validation/completenessChecks.ts"), "utf-8");
    assert.ok(!content.includes("server-only"));
    assert.ok(!content.includes("supabaseAdmin"));
  });

  it("plausibility checks are pure", () => {
    const content = readFileSync(join(root, "src/lib/validation/plausibilityChecks.ts"), "utf-8");
    assert.ok(!content.includes("server-only"));
    assert.ok(!content.includes("supabaseAdmin"));
  });

  it("validation run route exists", () => {
    assert.ok(existsSync(join(root, "src/app/api/deals/[dealId]/validation/run/route.ts")));
  });

  it("validation latest route exists", () => {
    assert.ok(existsSync(join(root, "src/app/api/deals/[dealId]/validation/latest/route.ts")));
  });

  it("memo generate gate includes validation check", () => {
    const content = readFileSync(join(root, "src/app/api/deals/[dealId]/credit-memo/generate/route.ts"), "utf-8");
    assert.ok(content.includes("buddy_validation_reports"), "memo gate must check validation");
    assert.ok(content.includes("BLOCK_GENERATION"), "memo gate must check for BLOCK_GENERATION");
  });

  it("snapshot hash caching exists in validation pass", () => {
    const content = readFileSync(join(root, "src/lib/validation/buddyValidationPass.ts"), "utf-8");
    assert.ok(content.includes("snapshot_hash"), "must cache by snapshot hash");
  });
});
