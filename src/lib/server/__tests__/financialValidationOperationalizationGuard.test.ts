/**
 * Phase 55C — Financial Validation Operationalization CI Guard
 *
 * Suites:
 * 1. Lifecycle gate integration
 * 2. Workbench page contract
 * 3. Rebuild endpoint contract
 * 4. Gate stage-awareness
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
// 1. Lifecycle gate integration
// ---------------------------------------------------------------------------

describe("Lifecycle gate — financial snapshot integration", () => {
  it("deriveLifecycleState references getFinancialSnapshotGate", () => {
    const content = readFile("buddy/lifecycle/deriveLifecycleState.ts");
    assert.ok(
      content.includes("getFinancialSnapshotGate"),
      "deriveLifecycleState must call getFinancialSnapshotGate",
    );
  });

  it("lifecycle model includes financial snapshot gate derived fields", () => {
    const content = readFile("buddy/lifecycle/model.ts");
    assert.ok(content.includes("financialSnapshotGateReady"), "must have financialSnapshotGateReady");
    assert.ok(content.includes("financialSnapshotGateCode"), "must have financialSnapshotGateCode");
    assert.ok(content.includes("financialSnapshotOpenReviewCount"), "must have financialSnapshotOpenReviewCount");
  });

  it("lifecycle model includes new blocker codes", () => {
    const content = readFile("buddy/lifecycle/model.ts");
    assert.ok(content.includes('"financial_snapshot_stale"'), "must support financial_snapshot_stale blocker");
    assert.ok(content.includes('"financial_validation_open"'), "must support financial_validation_open blocker");
  });

  it("computeBlockers uses financial gate derived fields", () => {
    const content = readFile("buddy/lifecycle/computeBlockers.ts");
    assert.ok(
      content.includes("financialSnapshotGateReady"),
      "computeBlockers must check financial gate readiness",
    );
  });

  it("financial gate only queries for committee-relevant stages", () => {
    const content = readFile("buddy/lifecycle/deriveLifecycleState.ts");
    assert.ok(
      content.includes("underwrite_in_progress") && content.includes("committee_ready"),
      "gate should only run for underwriting/committee stages",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Workbench page contract
// ---------------------------------------------------------------------------

describe("Financial validation workbench — page contract", () => {
  it("workbench page exists", () => {
    assert.ok(fileExists("app/(app)/deals/[dealId]/financial-validation/page.tsx"));
  });

  it("workbench page uses ensureDealBankAccess", () => {
    const content = readFile("app/(app)/deals/[dealId]/financial-validation/page.tsx");
    assert.ok(content.includes("ensureDealBankAccess"), "must check deal access");
  });

  it("workbench page uses DealPageErrorState for access denial", () => {
    const content = readFile("app/(app)/deals/[dealId]/financial-validation/page.tsx");
    assert.ok(content.includes("DealPageErrorState"), "must use DealPageErrorState");
  });

  it("workbench client component exists", () => {
    assert.ok(fileExists("components/deals/FinancialValidationWorkbench.tsx"));
  });

  it("workbench renders snapshot status, gaps, and lifecycle impact", () => {
    const content = readFile("components/deals/FinancialValidationWorkbench.tsx");
    assert.ok(content.includes("gap-queue"), "must load gap queue");
    assert.ok(content.includes("lifecycle"), "must load lifecycle impact");
    assert.ok(content.includes("Conflicts") || content.includes("conflict"), "must show conflicts");
    assert.ok(content.includes("Missing"), "must show missing facts");
  });
});

// ---------------------------------------------------------------------------
// 3. Rebuild endpoint contract
// ---------------------------------------------------------------------------

describe("Financial validation rebuild — endpoint contract", () => {
  it("rebuild route exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/financial-validation/rebuild/route.ts"));
  });

  it("rebuild route uses Clerk auth", () => {
    const content = readFile("app/api/deals/[dealId]/financial-validation/rebuild/route.ts");
    assert.ok(content.includes("requireDealCockpitAccess"), "must use deal cockpit access");
  });

  it("rebuild route logs the rebuild event", () => {
    const content = readFile("app/api/deals/[dealId]/financial-validation/rebuild/route.ts");
    assert.ok(content.includes("rebuild_requested") || content.includes("logLedgerEvent"),
      "must log rebuild event");
  });
});

// ---------------------------------------------------------------------------
// 4. Gate stage-awareness
// ---------------------------------------------------------------------------

describe("Financial snapshot gate — stage awareness", () => {
  it("gate returns structured evidence", () => {
    const content = readFile("lib/financial/snapshot/getFinancialSnapshotGate.ts");
    assert.ok(content.includes("evidence"), "must return evidence");
    assert.ok(content.includes("openReviewItems"), "evidence must include openReviewItems");
    assert.ok(content.includes("unresolvedConflicts"), "evidence must include unresolvedConflicts");
    assert.ok(content.includes("unresolvedMissingFacts"), "evidence must include unresolvedMissingFacts");
  });

  it("gate checks deal_gap_queue for open items", () => {
    const content = readFile("lib/financial/snapshot/getFinancialSnapshotGate.ts");
    assert.ok(content.includes("deal_gap_queue"), "must query deal_gap_queue");
  });

  it("gate is fail-open (never throws)", () => {
    const content = readFile("lib/financial/snapshot/getFinancialSnapshotGate.ts");
    assert.ok(content.includes("fail-open") || content.includes("catch"),
      "gate must handle errors gracefully");
  });
});

// ---------------------------------------------------------------------------
// 5. Placeholder regression
// ---------------------------------------------------------------------------

describe("Financial operationalization — no placeholder flows", () => {
  it("workbench has no alert() or coming soon", () => {
    const content = readFile("components/deals/FinancialValidationWorkbench.tsx");
    assert.ok(!content.includes("alert("), "no alert()");
    assert.ok(!/coming soon/i.test(content), "no Coming Soon");
  });

  it("workbench page has no placeholder markers", () => {
    const content = readFile("app/(app)/deals/[dealId]/financial-validation/page.tsx");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        assert.fail(`Placeholder in page.tsx:${i + 1}: ${line.trim()}`);
      }
    }
  });
});
