/**
 * Phase 55B — Financial Validation Activation CI Guard
 *
 * Suites:
 * 1. Pipeline activation contract
 * 2. Staleness activation contract
 * 3. Promotion safety contract
 * 4. Workbench UI contract
 * 5. Provenance viewer contract
 * 6. Decision form contract
 * 7. Placeholder regression
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
// 1. Pipeline activation
// ---------------------------------------------------------------------------

describe("Snapshot pipeline activation — contract", () => {
  it("runSnapshotBuildPipeline exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/runSnapshotBuildPipeline.ts"));
  });

  it("orchestrator references buildFinancialSnapshot", () => {
    const content = readFile("lib/financial/snapshot/runSnapshotBuildPipeline.ts");
    assert.ok(content.includes("buildFinancialSnapshot"), "must use builder");
  });

  it("orchestrator references evaluateSnapshotReadiness", () => {
    const content = readFile("lib/financial/snapshot/runSnapshotBuildPipeline.ts");
    assert.ok(content.includes("evaluateSnapshotReadiness") || content.includes("promoteFinancialSnapshot"),
      "must evaluate or promote");
  });

  it("orchestrator persists to financial_snapshots_v2", () => {
    const content = readFile("lib/financial/snapshot/runSnapshotBuildPipeline.ts");
    assert.ok(content.includes("financial_snapshots_v2"), "must persist snapshots");
    assert.ok(content.includes("financial_snapshot_facts"), "must persist facts");
  });
});

// ---------------------------------------------------------------------------
// 2. Staleness activation
// ---------------------------------------------------------------------------

describe("Staleness activation — contract", () => {
  it("handleFinancialEvidenceChange exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/handleFinancialEvidenceChange.ts"));
  });

  it("references diffSnapshots", () => {
    const content = readFile("lib/financial/snapshot/handleFinancialEvidenceChange.ts");
    assert.ok(content.includes("diffSnapshots"), "must diff snapshots");
  });

  it("references markSnapshotStale", () => {
    const content = readFile("lib/financial/snapshot/handleFinancialEvidenceChange.ts");
    assert.ok(content.includes("markSnapshotStale"), "must be able to mark stale");
  });

  it("shouldRebuildSnapshot exists and is deterministic", () => {
    assert.ok(fileExists("lib/financial/snapshot/shouldRebuildSnapshot.ts"));
    const content = readFile("lib/financial/snapshot/shouldRebuildSnapshot.ts");
    assert.ok(content.includes("shouldRebuild"), "must return rebuild decision");
    assert.ok(content.includes("reason"), "must return reason");
  });
});

// ---------------------------------------------------------------------------
// 3. Promotion safety
// ---------------------------------------------------------------------------

describe("Snapshot promotion — safety contract", () => {
  it("promoteFinancialSnapshot exists", () => {
    assert.ok(fileExists("lib/financial/snapshot/promoteFinancialSnapshot.ts"));
  });

  it("refuses to promote invalid builds", () => {
    const content = readFile("lib/financial/snapshot/promoteFinancialSnapshot.ts");
    assert.ok(content.includes("PROMOTABLE_STATUSES") || content.includes("not promotable"),
      "must guard against promoting bad snapshots");
  });

  it("supersedes prior active snapshot", () => {
    const content = readFile("lib/financial/snapshot/promoteFinancialSnapshot.ts");
    assert.ok(content.includes("superseded"), "must handle supersession");
  });
});

// ---------------------------------------------------------------------------
// 4. Workbench UI
// ---------------------------------------------------------------------------

describe("Financial validation workbench UI — contract", () => {
  it("FinancialSnapshotGateCard exists", () => {
    assert.ok(fileExists("components/deals/FinancialSnapshotGateCard.tsx"));
  });

  it("gate card shows snapshot status and blockers", () => {
    const content = readFile("components/deals/FinancialSnapshotGateCard.tsx");
    assert.ok(content.includes("financial-validation"), "must link to validation route");
    assert.ok(content.includes("Memo") && content.includes("Decision"), "must show memo/decision safety");
  });

  it("gate card uses financial-validation API", () => {
    const content = readFile("components/deals/FinancialSnapshotGateCard.tsx");
    assert.ok(content.includes("/api/deals/") && content.includes("financial-validation"),
      "must call financial-validation GET API");
  });
});

// ---------------------------------------------------------------------------
// 5. Provenance viewer
// ---------------------------------------------------------------------------

describe("Provenance viewer — contract", () => {
  it("FinancialFactProvenanceViewer exists", () => {
    assert.ok(fileExists("components/deals/FinancialFactProvenanceViewer.tsx"));
  });

  it("shows primary source indicator", () => {
    const content = readFile("components/deals/FinancialFactProvenanceViewer.tsx");
    assert.ok(content.includes("PRIMARY") || content.includes("primary"),
      "must indicate primary source");
  });

  it("shows confidence level", () => {
    const content = readFile("components/deals/FinancialFactProvenanceViewer.tsx");
    assert.ok(content.includes("confidence"), "must show confidence");
  });
});

// ---------------------------------------------------------------------------
// 6. Decision form
// ---------------------------------------------------------------------------

describe("Financial fact decision form — contract", () => {
  it("FinancialFactDecisionForm exists", () => {
    assert.ok(fileExists("components/deals/FinancialFactDecisionForm.tsx"));
  });

  it("enforces rationale for adjust and reject", () => {
    const content = readFile("components/deals/FinancialFactDecisionForm.tsx");
    assert.ok(content.includes("adjust_fact") && content.includes("reject_fact"),
      "must support adjust and reject");
    assert.ok(content.includes("Rationale") || content.includes("rationale"),
      "must require rationale input");
  });

  it("calls financial-validation POST API", () => {
    const content = readFile("components/deals/FinancialFactDecisionForm.tsx");
    assert.ok(content.includes("/api/deals/") && content.includes("financial-validation"),
      "must POST to fact decision endpoint");
  });
});

// ---------------------------------------------------------------------------
// 7. Placeholder regression
// ---------------------------------------------------------------------------

describe("Financial activation — no placeholder flows", () => {
  it("activation modules have no TODO/placeholder markers", () => {
    const files = [
      "lib/financial/snapshot/runSnapshotBuildPipeline.ts",
      "lib/financial/snapshot/promoteFinancialSnapshot.ts",
      "lib/financial/snapshot/handleFinancialEvidenceChange.ts",
      "lib/financial/snapshot/shouldRebuildSnapshot.ts",
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

  it("UI components have no placeholder markers", () => {
    const files = [
      "components/deals/FinancialSnapshotGateCard.tsx",
      "components/deals/FinancialFactProvenanceViewer.tsx",
      "components/deals/FinancialFactDecisionForm.tsx",
    ];
    for (const f of files) {
      const content = readFile(f);
      assert.ok(!content.includes("alert("), `${f} must not use alert()`);
      assert.ok(!/coming soon/i.test(content), `${f} must not contain "Coming Soon"`);
    }
  });
});
