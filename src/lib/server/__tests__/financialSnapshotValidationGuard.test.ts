/**
 * Phase 55A — Financial Snapshot Validation CI Guard
 *
 * Suites:
 * 1. Snapshot model contract (types + statuses)
 * 2. Fact provenance contract
 * 3. Snapshot gating contract
 * 4. Workbench action contract
 * 5. Staleness / supersession contract
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
// 1. Snapshot model contract
// ---------------------------------------------------------------------------

describe("Financial snapshot model — contract", () => {
  it("snapshot types exist", () => {
    assert.ok(fileExists("lib/financial/snapshot/types.ts"));
  });

  it("supports all canonical snapshot statuses", () => {
    const content = readFile("lib/financial/snapshot/types.ts");
    const required = [
      "not_started", "collecting_inputs", "generated", "needs_review",
      "partially_validated", "validated", "stale", "superseded",
    ];
    for (const s of required) {
      assert.ok(content.includes(`"${s}"`), `must support snapshot status "${s}"`);
    }
  });

  it("deriveSnapshotStatus helper exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/deriveSnapshotStatus.ts"));
  });

  it("buildFinancialSnapshot helper exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/buildFinancialSnapshot.ts"));
  });
});

// ---------------------------------------------------------------------------
// 2. Fact provenance contract
// ---------------------------------------------------------------------------

describe("Financial fact provenance — contract", () => {
  it("fact types include provenance and validation state", () => {
    const content = readFile("lib/financial/snapshot/financial-fact-types.ts");
    assert.ok(content.includes("FactProvenanceSource"), "must define provenance source");
    assert.ok(content.includes("FactValidationState"), "must define validation state");
    assert.ok(content.includes("documentId"), "provenance must reference documentId");
  });

  it("supports all fact validation states", () => {
    const content = readFile("lib/financial/snapshot/financial-fact-types.ts");
    const required = [
      "unreviewed", "auto_supported", "needs_review", "banker_confirmed",
      "banker_adjusted", "rejected", "conflicted", "missing",
    ];
    for (const s of required) {
      assert.ok(content.includes(`"${s}"`), `must support fact state "${s}"`);
    }
  });

  it("snapshot builder attaches provenance to facts", () => {
    const content = readFile("lib/financial/snapshot/buildFinancialSnapshot.ts");
    assert.ok(content.includes("provenance"), "builder must populate provenance");
    assert.ok(content.includes("documentId"), "provenance must reference source documents");
  });
});

// ---------------------------------------------------------------------------
// 3. Snapshot gating contract
// ---------------------------------------------------------------------------

describe("Snapshot gating — memo/decision readiness", () => {
  it("getFinancialSnapshotGate helper exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/getFinancialSnapshotGate.ts"));
  });

  it("gate can block on missing/conflicted/stale state", () => {
    const content = readFile("lib/financial/snapshot/getFinancialSnapshotGate.ts");
    assert.ok(content.includes("financialBlockers"), "must return blockers");
    assert.ok(content.includes("memoSafe"), "must return memoSafe");
    assert.ok(content.includes("decisionSafe"), "must return decisionSafe");
    assert.ok(content.includes("stale"), "must detect stale state");
  });

  it("evaluateSnapshotReadiness helper exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/evaluateSnapshotReadiness.ts"));
  });
});

// ---------------------------------------------------------------------------
// 4. Workbench action contract
// ---------------------------------------------------------------------------

describe("Financial fact decisions — action contract", () => {
  it("applyFinancialFactDecision helper exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/applyFinancialFactDecision.ts"));
  });

  it("adjust and reject require rationale", () => {
    const content = readFile("lib/financial/snapshot/applyFinancialFactDecision.ts");
    assert.ok(
      content.includes("adjust_fact") && content.includes("rationale"),
      "adjust_fact must require rationale",
    );
    assert.ok(
      content.includes("reject_fact") && content.includes("rationale"),
      "reject_fact must require rationale",
    );
  });

  it("conflict resolution requires selected source", () => {
    const content = readFile("lib/financial/snapshot/applyFinancialFactDecision.ts");
    assert.ok(
      content.includes("select_conflict_source") && content.includes("selectedProvenanceSourceDocumentId"),
      "conflict resolution must require source selection",
    );
  });

  it("validation API requires Clerk auth", () => {
    const content = readFile("app/api/deals/[dealId]/financial-validation/[factId]/route.ts");
    assert.ok(content.includes("requireDealCockpitAccess"), "must use deal cockpit access");
  });
});

// ---------------------------------------------------------------------------
// 5. Staleness / supersession
// ---------------------------------------------------------------------------

describe("Snapshot staleness / supersession — contract", () => {
  it("diffSnapshots helper exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/diffSnapshots.ts"));
  });

  it("diff can detect material changes", () => {
    const content = readFile("lib/financial/snapshot/diffSnapshots.ts");
    assert.ok(content.includes("changedFacts"), "must detect changed facts");
    assert.ok(content.includes("shouldMarkStale"), "must indicate staleness");
  });

  it("markSnapshotStale helper exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/markSnapshotStale.ts"));
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder regression
// ---------------------------------------------------------------------------

describe("Financial snapshot — no placeholder flows", () => {
  it("snapshot modules have no TODO/placeholder markers in non-comment code", () => {
    const files = [
      "lib/financial/snapshot/types.ts",
      "lib/financial/snapshot/financial-fact-types.ts",
      "lib/financial/snapshot/deriveSnapshotStatus.ts",
      "lib/financial/snapshot/buildFinancialSnapshot.ts",
      "lib/financial/snapshot/evaluateSnapshotReadiness.ts",
      "lib/financial/snapshot/applyFinancialFactDecision.ts",
      "lib/financial/snapshot/getFinancialSnapshotGate.ts",
      "lib/financial/snapshot/diffSnapshots.ts",
      "lib/financial/snapshot/markSnapshotStale.ts",
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
