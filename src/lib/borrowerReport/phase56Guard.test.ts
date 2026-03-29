/**
 * Phase 56 — Borrower Report Guard Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Phase 56 — Borrower Report Guards", () => {
  it("migration exists with both tables", () => {
    const content = readFileSync(join(root, "supabase/migrations/20260516_borrower_health_reports.sql"), "utf-8");
    assert.ok(content.includes("buddy_industry_benchmarks"));
    assert.ok(content.includes("buddy_borrower_reports"));
  });

  it("efficiency ratios are pure (no server-only, no DB)", () => {
    const content = readFileSync(join(root, "src/lib/ratios/efficiencyRatios.ts"), "utf-8");
    assert.ok(!content.includes("server-only"));
    assert.ok(!content.includes("supabaseAdmin"));
  });

  it("altman Z-score is pure", () => {
    const content = readFileSync(join(root, "src/lib/ratios/altmanZScore.ts"), "utf-8");
    assert.ok(!content.includes("server-only"));
    assert.ok(!content.includes("supabaseAdmin"));
  });

  it("health scoring is pure", () => {
    const content = readFileSync(join(root, "src/lib/ratios/healthScoring.ts"), "utf-8");
    assert.ok(!content.includes("server-only"));
    assert.ok(!content.includes("supabaseAdmin"));
  });

  it("generate route exists", () => {
    assert.ok(existsSync(join(root, "src/app/api/deals/[dealId]/borrower-report/generate/route.ts")));
  });

  it("latest route exists", () => {
    assert.ok(existsSync(join(root, "src/app/api/deals/[dealId]/borrower-report/latest/route.ts")));
  });

  it("UI panel exists", () => {
    assert.ok(existsSync(join(root, "src/components/borrower-report/BorrowerReportPanel.tsx")));
  });

  it("benchmark seed data has 10+ NAICS codes", () => {
    const content = readFileSync(join(root, "src/evals/seeds/industryBenchmarks.ts"), "utf-8");
    const matches = content.match(/naics_code: "/g);
    assert.ok(matches && matches.length >= 10, `Expected 10+ NAICS codes, found ${matches?.length}`);
  });

  it("no credit-decision language in borrower-facing panel", () => {
    const content = readFileSync(join(root, "src/components/borrower-report/BorrowerReportPanel.tsx"), "utf-8");
    assert.ok(!content.includes("credit score"), "must not say 'credit score'");
    assert.ok(!content.includes("loan approval"), "must not say 'loan approval'");
    assert.ok(!content.includes("DSCR floor"), "must not expose covenant language");
  });
});
