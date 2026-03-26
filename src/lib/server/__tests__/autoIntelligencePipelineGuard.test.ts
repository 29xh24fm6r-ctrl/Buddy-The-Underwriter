/**
 * Phase 58B — Auto-Intelligence Pipeline CI Guard
 *
 * Suites:
 * 1. Enqueue contract
 * 2. Pipeline runner contract
 * 3. State derivation contract
 * 4. API endpoints
 * 5. Migration
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
// 1. Enqueue
// ---------------------------------------------------------------------------

describe("Intelligence enqueue — contract", () => {
  it("enqueueAutoIntelligenceRun exists", () => {
    assert.ok(fileExists("lib/intelligence/auto/enqueueAutoIntelligenceRun.ts"));
  });

  it("prevents duplicate active runs", () => {
    const content = readFile("lib/intelligence/auto/enqueueAutoIntelligenceRun.ts");
    assert.ok(content.includes("alreadyActive"), "must detect existing active run");
  });

  it("seeds all 4 step rows", () => {
    const content = readFile("lib/intelligence/auto/enqueueAutoIntelligenceRun.ts");
    assert.ok(content.includes("extract_facts"), "must seed extract_facts");
    assert.ok(content.includes("generate_snapshot"), "must seed generate_snapshot");
    assert.ok(content.includes("lender_match"), "must seed lender_match");
    assert.ok(content.includes("risk_recompute"), "must seed risk_recompute");
  });

  it("emits ledger event", () => {
    const content = readFile("lib/intelligence/auto/enqueueAutoIntelligenceRun.ts");
    assert.ok(content.includes("auto_pipeline.requested"), "must emit request event");
  });
});

// ---------------------------------------------------------------------------
// 2. Pipeline runner
// ---------------------------------------------------------------------------

describe("Intelligence pipeline runner — contract", () => {
  it("runAutoIntelligencePipeline exists", () => {
    assert.ok(fileExists("lib/intelligence/auto/runAutoIntelligencePipeline.ts"));
  });

  it("runs all 4 steps", () => {
    const content = readFile("lib/intelligence/auto/runAutoIntelligencePipeline.ts");
    assert.ok(content.includes("extract_facts"), "must run extract_facts");
    assert.ok(content.includes("generate_snapshot"), "must run generate_snapshot");
    assert.ok(content.includes("lender_match"), "must run lender_match");
    assert.ok(content.includes("risk_recompute"), "must run risk_recompute");
  });

  it("handles partial success", () => {
    const content = readFile("lib/intelligence/auto/runAutoIntelligencePipeline.ts");
    assert.ok(content.includes('"partial"'), "must support partial status");
  });

  it("each step can skip independently", () => {
    const content = readFile("lib/intelligence/auto/runAutoIntelligencePipeline.ts");
    assert.ok(content.includes("skipped"), "must support step skip");
  });

  it("emits start and completion events", () => {
    const content = readFile("lib/intelligence/auto/runAutoIntelligencePipeline.ts");
    assert.ok(content.includes("auto_pipeline.started"), "must emit start");
    assert.ok(content.includes("auto_pipeline.succeeded") || content.includes("auto_pipeline.${overallStatus}"),
      "must emit completion");
  });
});

// ---------------------------------------------------------------------------
// 3. State derivation
// ---------------------------------------------------------------------------

describe("Intelligence state derivation — contract", () => {
  it("deriveAutoIntelligenceState exists", () => {
    assert.ok(fileExists("lib/intelligence/auto/deriveAutoIntelligenceState.ts"));
  });

  it("returns pipelineRunning and pipelineReady", () => {
    const content = readFile("lib/intelligence/auto/deriveAutoIntelligenceState.ts");
    assert.ok(content.includes("pipelineRunning"), "must return running state");
    assert.ok(content.includes("pipelineReady"), "must return ready state");
  });

  it("returns step-level details with labels", () => {
    const content = readFile("lib/intelligence/auto/deriveAutoIntelligenceState.ts");
    assert.ok(content.includes("STEP_LABELS"), "must have human labels");
    assert.ok(content.includes("failedStepCount"), "must count failures");
    assert.ok(content.includes("succeededStepCount"), "must count successes");
  });
});

// ---------------------------------------------------------------------------
// 4. API endpoints
// ---------------------------------------------------------------------------

describe("Intelligence API — contract", () => {
  it("GET state endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/intelligence/auto/route.ts"));
  });

  it("POST retry endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/intelligence/auto/retry/route.ts"));
  });

  it("both use Clerk auth", () => {
    const get = readFile("app/api/deals/[dealId]/intelligence/auto/route.ts");
    const post = readFile("app/api/deals/[dealId]/intelligence/auto/retry/route.ts");
    assert.ok(get.includes("requireDealCockpitAccess"), "GET must use cockpit access");
    assert.ok(post.includes("requireDealCockpitAccess"), "POST must use cockpit access");
  });

  it("retry prevents duplicate runs", () => {
    const content = readFile("app/api/deals/[dealId]/intelligence/auto/retry/route.ts");
    assert.ok(content.includes("already_running"), "must handle duplicate");
  });
});

// ---------------------------------------------------------------------------
// 5. Migration
// ---------------------------------------------------------------------------

describe("Intelligence pipeline migration — tables", () => {
  it("creates both tables", () => {
    const content = readFile("../supabase/migrations/20260326_auto_intelligence_pipeline.sql");
    assert.ok(content.includes("deal_intelligence_runs"), "must create runs table");
    assert.ok(content.includes("deal_intelligence_steps"), "must create steps table");
  });

  it("steps support all 4 codes", () => {
    const content = readFile("../supabase/migrations/20260326_auto_intelligence_pipeline.sql");
    for (const code of ["extract_facts", "generate_snapshot", "lender_match", "risk_recompute"]) {
      assert.ok(content.includes(code), `must support step code "${code}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder regression
// ---------------------------------------------------------------------------

describe("Intelligence pipeline — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/intelligence/auto/enqueueAutoIntelligenceRun.ts",
      "lib/intelligence/auto/runAutoIntelligencePipeline.ts",
      "lib/intelligence/auto/deriveAutoIntelligenceState.ts",
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
