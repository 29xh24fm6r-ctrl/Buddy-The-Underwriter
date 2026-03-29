/**
 * Phase 55 — Covenant Engine Guard Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Phase 55 — Covenant Engine Guards", () => {
  it("migration exists with both tables", () => {
    const content = readFileSync(join(root, "supabase/migrations/20260515_covenant_packages.sql"), "utf-8");
    assert.ok(content.includes("buddy_covenant_packages"));
    assert.ok(content.includes("buddy_covenant_overrides"));
  });

  it("rule engine is pure (no server-only, no DB)", () => {
    const content = readFileSync(join(root, "src/lib/covenants/covenantRuleEngine.ts"), "utf-8");
    assert.ok(!content.includes("server-only"), "rule engine must be pure");
    assert.ok(!content.includes("supabaseAdmin"), "rule engine must not access DB");
  });

  it("rule config is version-controlled", () => {
    const content = readFileSync(join(root, "src/lib/covenants/covenantRuleConfig.ts"), "utf-8");
    assert.ok(content.includes('version:'), "must have version");
    assert.ok(content.includes("dscrFloors"), "must have DSCR floors");
    assert.ok(content.includes("leverageCaps"), "must have leverage caps");
  });

  it("override route requires justification", () => {
    const content = readFileSync(join(root, "src/app/api/deals/[dealId]/covenants/override/route.ts"), "utf-8");
    assert.ok(content.includes("justification"), "overrides must require justification");
  });

  it("override table is append-only (no update/delete in handler)", () => {
    const content = readFileSync(join(root, "src/app/api/deals/[dealId]/covenants/override/route.ts"), "utf-8");
    assert.ok(content.includes(".insert("), "must use insert");
    assert.ok(!content.includes(".update("), "must not update overrides");
    assert.ok(!content.includes(".delete("), "must not delete overrides");
  });

  it("generate route exists", () => {
    assert.ok(existsSync(join(root, "src/app/api/deals/[dealId]/covenants/generate/route.ts")));
  });

  it("latest route exists", () => {
    assert.ok(existsSync(join(root, "src/app/api/deals/[dealId]/covenants/latest/route.ts")));
  });

  it("UI panel exists", () => {
    assert.ok(existsSync(join(root, "src/components/covenants/CovenantPackagePanel.tsx")));
  });

  it("all four families in types", () => {
    const content = readFileSync(join(root, "src/lib/covenants/covenantTypes.ts"), "utf-8");
    assert.ok(content.includes("FinancialCovenant"));
    assert.ok(content.includes("ReportingCovenant"));
    assert.ok(content.includes("BehavioralCovenant"));
    assert.ok(content.includes("SpringingCovenant"));
  });
});
