/**
 * Phase 60 — Insight Engine CI Guard
 *
 * Suites:
 * 1. Derivation contract
 * 2. API endpoint
 * 3. UI panel
 * 4. Cockpit integration
 * 5. Read-only guarantee
 * 6. Placeholder regression
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
// 1. Derivation contract
// ---------------------------------------------------------------------------

describe("Deal insight derivation — contract", () => {
  it("deriveDealInsights exists", () => {
    assert.ok(fileExists("lib/intelligence/insights/deriveDealInsights.ts"));
  });

  it("returns status + summary + recommendation + 4 buckets + nextAction + evidence", () => {
    const content = readFile("lib/intelligence/insights/deriveDealInsights.ts");
    assert.ok(content.includes("status"), "must return status");
    assert.ok(content.includes("summary"), "must return summary");
    assert.ok(content.includes("recommendation"), "must return recommendation");
    assert.ok(content.includes("risks"), "must return risks");
    assert.ok(content.includes("mitigants"), "must return mitigants");
    assert.ok(content.includes("opportunities"), "must return opportunities");
    assert.ok(content.includes("blockers"), "must return blockers");
    assert.ok(content.includes("nextAction"), "must return nextAction");
    assert.ok(content.includes("evidence"), "must return evidence");
  });

  it("supports all 4 status values", () => {
    const content = readFile("lib/intelligence/insights/deriveDealInsights.ts");
    for (const s of ["not_ready", "ready", "partial", "attention_needed"]) {
      assert.ok(content.includes(`"${s}"`), `must support status "${s}"`);
    }
  });

  it("recommendation priority: lifecycle > snapshot > lender > fallback", () => {
    const content = readFile("lib/intelligence/insights/deriveDealInsights.ts");
    assert.ok(content.includes("lifecycleNextAction"), "must check lifecycle first");
    assert.ok(content.includes("snapshotNarrative?.recommendation"), "must check snapshot second");
    assert.ok(content.includes("lenderMatchCount"), "must check lender third");
  });

  it("distinguishes credit, process, and structural categories", () => {
    const content = readFile("lib/intelligence/insights/deriveDealInsights.ts");
    assert.ok(content.includes('"credit"'), "must have credit category");
    assert.ok(content.includes('"process"'), "must have process category");
    assert.ok(content.includes('"opportunity"'), "must have opportunity category");
  });
});

// ---------------------------------------------------------------------------
// 2. API endpoint
// ---------------------------------------------------------------------------

describe("Insight API — contract", () => {
  it("endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/insights/route.ts"));
  });

  it("uses Clerk auth", () => {
    const content = readFile("app/api/deals/[dealId]/insights/route.ts");
    assert.ok(content.includes("requireDealCockpitAccess"), "must use cockpit access");
  });

  it("reads from existing systems without creating new persistence", () => {
    const content = readFile("app/api/deals/[dealId]/insights/route.ts");
    assert.ok(content.includes("deal_intelligence_runs"), "must read intelligence runs");
    assert.ok(content.includes("deal_truth_snapshots"), "must read snapshots");
    assert.ok(content.includes("deal_risk_pricing_model"), "must read risk pricing");
    // Must NOT write to any new insight table
    assert.ok(!content.includes(".insert(") || content.includes("// insert"), "must not write new insight records");
  });

  it("calls deriveDealInsights", () => {
    const content = readFile("app/api/deals/[dealId]/insights/route.ts");
    assert.ok(content.includes("deriveDealInsights"), "must use derivation function");
  });
});

// ---------------------------------------------------------------------------
// 3. UI panel
// ---------------------------------------------------------------------------

describe("InsightPanel — contract", () => {
  it("component exists", () => {
    assert.ok(fileExists("components/deals/cockpit/panels/InsightPanel.tsx"));
  });

  it("shows status, summary, recommendation, and 4 buckets", () => {
    const content = readFile("components/deals/cockpit/panels/InsightPanel.tsx");
    assert.ok(content.includes("Risks"), "must show risks bucket");
    assert.ok(content.includes("Mitigants"), "must show mitigants bucket");
    assert.ok(content.includes("Opportunities"), "must show opportunities bucket");
    assert.ok(content.includes("Blockers"), "must show blockers bucket");
    assert.ok(content.includes("recommendation"), "must show recommendation");
  });

  it("shows evidence footer", () => {
    const content = readFile("components/deals/cockpit/panels/InsightPanel.tsx");
    assert.ok(content.includes("Based on"), "must show evidence attribution");
    assert.ok(content.includes("snapshot") && content.includes("lenders") && content.includes("risk"),
      "must attribute sources");
  });

  it("fetches from /insights API", () => {
    const content = readFile("components/deals/cockpit/panels/InsightPanel.tsx");
    assert.ok(content.includes("/api/deals/") && content.includes("/insights"),
      "must call insights endpoint");
  });
});

// ---------------------------------------------------------------------------
// 4. Cockpit integration
// ---------------------------------------------------------------------------

describe("DealCockpitClient — insight integration", () => {
  it("imports InsightPanel", () => {
    const content = readFile("components/deals/DealCockpitClient.tsx");
    assert.ok(content.includes("InsightPanel"), "must import InsightPanel");
  });

  it("renders InsightPanel below IntelligencePanel", () => {
    const content = readFile("components/deals/DealCockpitClient.tsx");
    const intelIdx = content.indexOf("<IntelligencePanel");
    const insightIdx = content.indexOf("<InsightPanel");
    assert.ok(intelIdx >= 0 && insightIdx >= 0, "both panels must exist");
    assert.ok(insightIdx > intelIdx, "InsightPanel must be after IntelligencePanel");
  });
});

// ---------------------------------------------------------------------------
// 5. Read-only guarantee
// ---------------------------------------------------------------------------

describe("Insight engine — read-only guarantee", () => {
  it("derivation module has no DB imports", () => {
    const content = readFile("lib/intelligence/insights/deriveDealInsights.ts");
    assert.ok(!content.includes("supabaseAdmin"), "derivation must not import DB");
    assert.ok(!content.includes("server-only"), "derivation must be a pure function");
  });

  it("no new insight persistence tables", () => {
    // Check that no migration creates deal_insights or similar
    const migrationDir = path.join(SRC_ROOT, "../supabase/migrations");
    const files = fs.readdirSync(migrationDir);
    const insightMigrations = files.filter((f) => f.includes("insight") && f.includes("20260327"));
    assert.equal(insightMigrations.length, 0, "Phase 60 must not create new insight persistence tables");
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder regression
// ---------------------------------------------------------------------------

describe("Insight engine — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/intelligence/insights/deriveDealInsights.ts",
      "components/deals/cockpit/panels/InsightPanel.tsx",
    ];
    for (const f of files) {
      const content = readFile(f);
      assert.ok(!content.includes("alert("), `${f} must not use alert()`);
      assert.ok(!/coming soon/i.test(content), `${f} must not contain 'Coming Soon'`);
    }
  });
});
