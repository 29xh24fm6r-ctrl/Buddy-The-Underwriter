/**
 * Phase 55G — Operating Spine CI Guard
 *
 * Suites:
 * 1. Execution backbone contract
 * 2. Operating object tables (via migration)
 * 3. Next step engine contract
 * 4. API endpoint contract
 * 5. Placeholder regression
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(SRC_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// 1. Execution backbone
// ---------------------------------------------------------------------------

describe("Credit action execution — contract", () => {
  it("executeCreditAction exists", () => {
    assert.ok(fileExists("lib/creditActioning/executeCreditAction.ts"));
  });

  it("routes to all target systems", () => {
    const content = readFile("lib/creditActioning/executeCreditAction.ts");
    assert.ok(content.includes("deal_conditions"), "must create conditions");
    assert.ok(content.includes("deal_covenants"), "must create covenants");
    assert.ok(content.includes("deal_reporting_requirements"), "must create reporting");
    assert.ok(content.includes("deal_monitoring_seeds"), "must create monitoring");
  });

  it("is idempotent", () => {
    const content = readFile("lib/creditActioning/executeCreditAction.ts");
    assert.ok(content.includes("already_exists"), "must handle idempotency");
  });

  it("records execution audit trail", () => {
    const content = readFile("lib/creditActioning/executeCreditAction.ts");
    assert.ok(content.includes("deal_action_executions"), "must record execution");
  });

  it("updates recommendation status to implemented", () => {
    const content = readFile("lib/creditActioning/executeCreditAction.ts");
    assert.ok(content.includes('"implemented"'), "must update to implemented");
  });
});

// ---------------------------------------------------------------------------
// 2. Operating object tables
// ---------------------------------------------------------------------------

describe("Operating spine migration — tables", () => {
  it("migration creates all required tables", () => {
    const content = readFile("../supabase/migrations/20260326_operating_spine.sql");
    assert.ok(content.includes("deal_covenants"), "must create covenants table");
    assert.ok(content.includes("deal_reporting_requirements"), "must create reporting table");
    assert.ok(content.includes("deal_monitoring_seeds"), "must create monitoring table");
    assert.ok(content.includes("deal_action_executions"), "must create execution table");
  });

  it("covenants have metric + threshold + frequency", () => {
    const content = readFile("../supabase/migrations/20260326_operating_spine.sql");
    assert.ok(content.includes("metric") && content.includes("threshold") && content.includes("testing_frequency"),
      "covenants must have metric, threshold, testing_frequency");
  });
});

// ---------------------------------------------------------------------------
// 3. Next step engine
// ---------------------------------------------------------------------------

describe("Next step engine — contract", () => {
  it("getDealNextStep exists", () => {
    assert.ok(fileExists("lib/dealCommandCenter/getDealNextStep.ts"));
  });

  it("returns label, href, reason, priority, domain", () => {
    const content = readFile("lib/dealCommandCenter/getDealNextStep.ts");
    assert.ok(content.includes("label"), "must return label");
    assert.ok(content.includes("href"), "must return href");
    assert.ok(content.includes("reason"), "must return reason");
    assert.ok(content.includes("priority"), "must return priority");
    assert.ok(content.includes("domain"), "must return domain");
  });

  it("prioritizes financial validation blocking", () => {
    const content = readFile("lib/dealCommandCenter/getDealNextStep.ts");
    assert.ok(content.includes("financialValidationBlocked"), "must check financial validation");
    assert.ok(content.includes("financial-validation"), "must route to validation page");
  });

  it("handles all action domains", () => {
    const content = readFile("lib/dealCommandCenter/getDealNextStep.ts");
    for (const d of ["borrower", "underwrite", "pricing", "memo", "committee", "servicing"]) {
      assert.ok(content.includes(`"${d}"`), `must handle domain "${d}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. API endpoints
// ---------------------------------------------------------------------------

describe("Operating spine API — contract", () => {
  it("next-step endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/next-step/route.ts"));
  });

  it("next-step uses Clerk auth", () => {
    const content = readFile("app/api/deals/[dealId]/next-step/route.ts");
    assert.ok(content.includes("requireDealCockpitAccess"), "must use cockpit access");
  });

  it("next-step queries operating tables", () => {
    const content = readFile("app/api/deals/[dealId]/next-step/route.ts");
    assert.ok(content.includes("credit_action_recommendations"), "must query actions");
    assert.ok(content.includes("deal_covenants"), "must query covenants");
    assert.ok(content.includes("deal_monitoring_seeds"), "must query monitoring");
  });
});

// ---------------------------------------------------------------------------
// 5. Placeholder regression
// ---------------------------------------------------------------------------

describe("Operating spine — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/creditActioning/executeCreditAction.ts",
      "lib/dealCommandCenter/getDealNextStep.ts",
    ];
    for (const f of files) {
      const content = readFile(f);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          assert.fail(`Placeholder in ${f}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  });
});
