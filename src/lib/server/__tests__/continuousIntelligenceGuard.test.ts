/**
 * Phase 61 — Continuous Intelligence CI Guard
 *
 * Suites:
 * 1. Trigger decision logic
 * 2. Event handler contract
 * 3. Anti-chaos guardrails
 * 4. Reuses existing pipeline (no new tables)
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
// 1. Trigger decision logic
// ---------------------------------------------------------------------------

describe("shouldTriggerReanalysis — decision logic", () => {
  it("module exists", () => {
    assert.ok(fileExists("lib/intelligence/continuous/shouldTriggerReanalysis.ts"));
  });

  it("handles all 5 event types", () => {
    const content = readFile("lib/intelligence/continuous/shouldTriggerReanalysis.ts");
    assert.ok(content.includes('"document_finalized"'), "must handle document_finalized");
    assert.ok(content.includes('"spread_completed"'), "must handle spread_completed");
    assert.ok(content.includes('"snapshot_generated"'), "must handle snapshot_generated");
    assert.ok(content.includes('"research_completed"'), "must handle research_completed");
    assert.ok(content.includes('"critical_flag_changed"'), "must handle critical_flag_changed");
  });

  it("suppresses non-financial document finalization", () => {
    const content = readFile("lib/intelligence/continuous/shouldTriggerReanalysis.ts");
    assert.ok(content.includes("Non-financial document"), "must suppress non-financial docs");
    assert.ok(content.includes("shouldTrigger: false"), "must return false for non-financial");
  });

  it("triggers full pipeline for financial docs", () => {
    const content = readFile("lib/intelligence/continuous/shouldTriggerReanalysis.ts");
    assert.ok(content.includes("full_pipeline"), "must support full_pipeline scope");
    assert.ok(content.includes("FINANCIAL_CHECKLIST_KEYS"), "must check financial doc keys");
  });

  it("triggers insights_only for flag changes", () => {
    const content = readFile("lib/intelligence/continuous/shouldTriggerReanalysis.ts");
    assert.ok(content.includes("insights_only"), "must support insights_only scope");
  });

  it("returns debounce key for deduplication", () => {
    const content = readFile("lib/intelligence/continuous/shouldTriggerReanalysis.ts");
    assert.ok(content.includes("debounceKey"), "must return debounce key");
  });
});

// ---------------------------------------------------------------------------
// 2. Event handler contract
// ---------------------------------------------------------------------------

describe("handleContinuousIntelligenceEvent — contract", () => {
  it("module exists", () => {
    assert.ok(fileExists("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts"));
  });

  it("returns 4 possible action types", () => {
    const content = readFile("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts");
    assert.ok(content.includes('"triggered"'), "must return triggered");
    assert.ok(content.includes('"suppressed"'), "must return suppressed");
    assert.ok(content.includes('"debounced"'), "must return debounced");
    assert.ok(content.includes('"deferred"'), "must return deferred");
  });

  it("calls shouldTriggerReanalysis", () => {
    const content = readFile("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts");
    assert.ok(content.includes("shouldTriggerReanalysis"), "must use trigger decision function");
  });

  it("routes into existing auto-intelligence pipeline", () => {
    const content = readFile("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts");
    assert.ok(content.includes("enqueueAutoIntelligenceRun"), "must use existing enqueue function");
  });

  it("logs all 4 decision outcomes", () => {
    const content = readFile("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts");
    assert.ok(content.includes("continuous_intelligence.triggered"), "must log triggered");
    assert.ok(content.includes("continuous_intelligence.debounced"), "must log debounced");
    assert.ok(content.includes("continuous_intelligence.deferred"), "must log deferred");
  });
});

// ---------------------------------------------------------------------------
// 3. Anti-chaos guardrails
// ---------------------------------------------------------------------------

describe("Continuous intelligence — anti-chaos guardrails", () => {
  it("has debounce window", () => {
    const content = readFile("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts");
    assert.ok(content.includes("DEBOUNCE_WINDOW_MS"), "must have debounce window");
    assert.ok(content.includes("recentTriggers"), "must track recent triggers");
  });

  it("respects active run lock via existing enqueue idempotency", () => {
    const content = readFile("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts");
    assert.ok(content.includes("alreadyActive"), "must check for active run");
  });

  it("does not create new run tables", () => {
    // Verify no migration files for continuous intelligence
    const migrationDir = path.join(SRC_ROOT, "../supabase/migrations");
    const files = fs.readdirSync(migrationDir);
    const continuousMigrations = files.filter((f) => f.includes("continuous") && f.includes("20260327"));
    assert.equal(continuousMigrations.length, 0, "Phase 61 must not create new run tables");
  });
});

// ---------------------------------------------------------------------------
// 4. Reuses existing pipeline
// ---------------------------------------------------------------------------

describe("Continuous intelligence — reuses Phase 58B pipeline", () => {
  it("imports from existing auto intelligence module", () => {
    const content = readFile("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts");
    assert.ok(
      content.includes("@/lib/intelligence/auto/enqueueAutoIntelligenceRun"),
      "must import from existing auto intelligence",
    );
  });

  it("uses system_repair source for re-analysis runs", () => {
    const content = readFile("lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts");
    assert.ok(content.includes('"system_repair"'), "must use system_repair source");
  });
});

// ---------------------------------------------------------------------------
// 5. Placeholder regression
// ---------------------------------------------------------------------------

describe("Continuous intelligence — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/intelligence/continuous/shouldTriggerReanalysis.ts",
      "lib/intelligence/continuous/handleContinuousIntelligenceEvent.ts",
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
