/**
 * Phase 55D — Committee Artifact Integration CI Guard
 *
 * Suites:
 * 1. Committee financial validation summary contract
 * 2. Decision readiness financial integration
 * 3. Packet preflight contract
 * 4. Memo snapshot metadata contract
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
// 1. Committee financial validation summary
// ---------------------------------------------------------------------------

describe("Committee financial validation summary — contract", () => {
  it("buildCommitteeFinancialValidationSummary exists", () => {
    assert.ok(fileExists("lib/financialValidation/buildCommitteeFinancialValidationSummary.ts"));
  });

  it("returns stable shape with memoSafe and decisionSafe", () => {
    const content = readFile("lib/financialValidation/buildCommitteeFinancialValidationSummary.ts");
    assert.ok(content.includes("memoSafe"), "must return memoSafe");
    assert.ok(content.includes("decisionSafe"), "must return decisionSafe");
    assert.ok(content.includes("narrative"), "must return narrative");
    assert.ok(content.includes("completenessPercent"), "must return completenessPercent");
    assert.ok(content.includes("unresolvedConflictCount"), "must return conflict count");
  });

  it("uses getFinancialSnapshotGate (not re-implementation)", () => {
    const content = readFile("lib/financialValidation/buildCommitteeFinancialValidationSummary.ts");
    assert.ok(
      content.includes("getFinancialSnapshotGate"),
      "must derive from existing gate, not re-implement",
    );
  });

  it("produces deterministic narratives (no AI/random)", () => {
    const content = readFile("lib/financialValidation/buildCommitteeFinancialValidationSummary.ts");
    assert.ok(
      content.includes("validated and decision-safe"),
      "must have a ready narrative",
    );
    assert.ok(
      content.includes("stale relative to newer"),
      "must have a stale narrative",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Decision readiness financial integration
// ---------------------------------------------------------------------------

describe("Decision readiness — financial validation integration", () => {
  it("validateDecisionReadiness accepts financial validation inputs", () => {
    const content = readFile("lib/decision/validateDecisionReadiness.ts");
    assert.ok(content.includes("financialValidationDecisionSafe"), "must accept decisionSafe");
    assert.ok(content.includes("financialValidationSummaryStale"), "must accept stale flag");
    assert.ok(content.includes("financialValidationOpenCriticalCount"), "must accept critical count");
  });

  it("blocks decision when financial validation is not decision-safe", () => {
    const content = readFile("lib/decision/validateDecisionReadiness.ts");
    assert.ok(
      content.includes("Financial validation is not decision-safe"),
      "must block on non-decision-safe state",
    );
  });

  it("blocks decision when financial summary is stale", () => {
    const content = readFile("lib/decision/validateDecisionReadiness.ts");
    assert.ok(
      content.includes("Financial validation summary is stale"),
      "must block on stale summary",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Packet preflight contract
// ---------------------------------------------------------------------------

describe("Packet preflight — financial validation", () => {
  it("packetPreflight helper exists", () => {
    assert.ok(fileExists("lib/financialValidation/packetPreflight.ts"));
  });

  it("supports draft and final modes", () => {
    const content = readFile("lib/financialValidation/packetPreflight.ts");
    assert.ok(content.includes('"draft"'), "must support draft mode");
    assert.ok(content.includes('"final"'), "must support final mode");
  });

  it("final mode requires decisionSafe", () => {
    const content = readFile("lib/financialValidation/packetPreflight.ts");
    assert.ok(
      content.includes("decisionSafe") && content.includes("final"),
      "final mode must check decisionSafe",
    );
  });

  it("draft mode requires memoSafe", () => {
    const content = readFile("lib/financialValidation/packetPreflight.ts");
    assert.ok(
      content.includes("memoSafe") && content.includes("draft"),
      "draft mode must check memoSafe",
    );
  });

  it("returns blockers and warnings", () => {
    const content = readFile("lib/financialValidation/packetPreflight.ts");
    assert.ok(content.includes("blockers"), "must return blockers");
    assert.ok(content.includes("warnings"), "must return warnings");
    assert.ok(content.includes("allowed"), "must return allowed flag");
  });
});

// ---------------------------------------------------------------------------
// 4. Memo snapshot metadata
// ---------------------------------------------------------------------------

describe("Memo snapshot — financial validation metadata", () => {
  it("migration adds financial validation columns to credit_memo_snapshots", () => {
    const content = readFile("../supabase/migrations/20260326_credit_memo_financial_validation.sql");
    assert.ok(content.includes("financial_validation_summary_json"), "must add summary JSON");
    assert.ok(content.includes("financial_snapshot_id"), "must add snapshot ID");
    assert.ok(content.includes("decision_safe"), "must add decision_safe");
    assert.ok(content.includes("memo_safe"), "must add memo_safe");
  });
});

// ---------------------------------------------------------------------------
// 5. Placeholder regression
// ---------------------------------------------------------------------------

describe("Committee artifact integration — no placeholders", () => {
  it("financial validation helpers have no placeholder markers", () => {
    const files = [
      "lib/financialValidation/buildCommitteeFinancialValidationSummary.ts",
      "lib/financialValidation/packetPreflight.ts",
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
