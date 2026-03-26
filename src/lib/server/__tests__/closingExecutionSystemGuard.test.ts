/**
 * Phase 57 — Closing Execution System CI Guard
 *
 * Suites:
 * 1. Execution state derivation
 * 2. Execution run creation
 * 3. Provider abstraction
 * 4. Funding authorization gate
 * 5. API endpoints
 * 6. Migration tables
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
// 1. Execution state derivation
// ---------------------------------------------------------------------------

describe("Closing execution derivation — contract", () => {
  it("deriveClosingExecutionState exists", () => {
    assert.ok(fileExists("lib/closing/deriveClosingExecutionState.ts"));
  });

  it("supports all execution statuses", () => {
    const content = readFile("lib/closing/deriveClosingExecutionState.ts");
    for (const s of ["draft", "ready_to_send", "sent", "partially_signed", "fully_signed", "conditions_pending", "execution_complete", "cancelled", "superseded"]) {
      assert.ok(content.includes(`"${s}"`), `must support status "${s}"`);
    }
  });

  it("computes signaturesRemaining and conditionsRemaining", () => {
    const content = readFile("lib/closing/deriveClosingExecutionState.ts");
    assert.ok(content.includes("signaturesRemaining"), "must compute signatures remaining");
    assert.ok(content.includes("conditionsRemaining"), "must compute conditions remaining");
  });

  it("computes executionPct", () => {
    const content = readFile("lib/closing/deriveClosingExecutionState.ts");
    assert.ok(content.includes("executionPct"), "must compute execution percentage");
  });
});

// ---------------------------------------------------------------------------
// 2. Execution run creation
// ---------------------------------------------------------------------------

describe("Execution run creation — contract", () => {
  it("createClosingExecutionRun exists", () => {
    assert.ok(fileExists("lib/closing/createClosingExecutionRun.ts"));
  });

  it("seeds condition states from checklist", () => {
    const content = readFile("lib/closing/createClosingExecutionRun.ts");
    assert.ok(content.includes("closing_condition_states"), "must seed conditions");
    assert.ok(content.includes("closing_checklist_items"), "must read from checklist");
  });

  it("emits audit event", () => {
    const content = readFile("lib/closing/createClosingExecutionRun.ts");
    assert.ok(content.includes("closing.package.execution.created"), "must emit creation event");
  });
});

// ---------------------------------------------------------------------------
// 3. Provider abstraction
// ---------------------------------------------------------------------------

describe("Closing provider abstraction — contract", () => {
  it("provider types exist", () => {
    assert.ok(fileExists("lib/closing/providers/types.ts"));
  });

  it("defines ClosingProvider interface", () => {
    const content = readFile("lib/closing/providers/types.ts");
    assert.ok(content.includes("ClosingProvider"), "must define ClosingProvider");
    assert.ok(content.includes("createEnvelope"), "must have createEnvelope");
    assert.ok(content.includes("getEnvelopeStatus"), "must have getEnvelopeStatus");
    assert.ok(content.includes("voidEnvelope"), "must have voidEnvelope");
    assert.ok(content.includes("downloadCompletedArtifacts"), "must have download");
  });

  it("mock provider exists", () => {
    assert.ok(fileExists("lib/closing/providers/mockProvider.ts"));
    const content = readFile("lib/closing/providers/mockProvider.ts");
    assert.ok(content.includes("mockProvider"), "must export mockProvider");
  });
});

// ---------------------------------------------------------------------------
// 4. Funding authorization gate
// ---------------------------------------------------------------------------

describe("Funding authorization gate — contract", () => {
  it("getFundingAuthorizationGate exists", () => {
    assert.ok(fileExists("lib/closing/getFundingAuthorizationGate.ts"));
  });

  it("checks execution complete + signatures + conditions + authorization", () => {
    const content = readFile("lib/closing/getFundingAuthorizationGate.ts");
    assert.ok(content.includes("executionComplete"), "must check execution complete");
    assert.ok(content.includes("signaturesRemaining"), "must check signatures");
    assert.ok(content.includes("conditionsRemaining"), "must check conditions");
    assert.ok(content.includes("fundingAuthorized"), "must check authorization");
  });

  it("uses deriveClosingExecutionState", () => {
    const content = readFile("lib/closing/getFundingAuthorizationGate.ts");
    assert.ok(content.includes("deriveClosingExecutionState"), "must use derivation engine");
  });
});

// ---------------------------------------------------------------------------
// 5. API endpoints
// ---------------------------------------------------------------------------

describe("Closing execution API — contract", () => {
  it("execution GET endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/closing/execution/route.ts"));
  });

  it("funding authorize endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/closing/funding/authorize/route.ts"));
  });

  it("both use Clerk auth", () => {
    const exec = readFile("app/api/deals/[dealId]/closing/execution/route.ts");
    const fund = readFile("app/api/deals/[dealId]/closing/funding/authorize/route.ts");
    assert.ok(exec.includes("requireDealCockpitAccess"), "execution must use cockpit access");
    assert.ok(fund.includes("requireDealCockpitAccess"), "funding must use cockpit access");
  });

  it("funding requires execution_complete", () => {
    const content = readFile("app/api/deals/[dealId]/closing/funding/authorize/route.ts");
    assert.ok(content.includes("execution_not_complete"), "must block when not complete");
  });
});

// ---------------------------------------------------------------------------
// 6. Migration
// ---------------------------------------------------------------------------

describe("Closing execution migration — tables", () => {
  it("creates all 5 tables", () => {
    const content = readFile("../supabase/migrations/20260326_closing_execution_system.sql");
    assert.ok(content.includes("closing_execution_runs"), "must create execution runs");
    assert.ok(content.includes("closing_document_recipients"), "must create recipients");
    assert.ok(content.includes("closing_document_actions"), "must create actions");
    assert.ok(content.includes("closing_condition_states"), "must create condition states");
    assert.ok(content.includes("funding_authorizations"), "must create funding authorizations");
  });

  it("execution runs support full state machine", () => {
    const content = readFile("../supabase/migrations/20260326_closing_execution_system.sql");
    for (const s of ["draft", "ready_to_send", "sent", "partially_signed", "fully_signed", "conditions_pending", "execution_complete", "cancelled", "superseded"]) {
      assert.ok(content.includes(s), `must support execution status "${s}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Placeholder regression
// ---------------------------------------------------------------------------

describe("Closing execution — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/closing/createClosingExecutionRun.ts",
      "lib/closing/deriveClosingExecutionState.ts",
      "lib/closing/getFundingAuthorizationGate.ts",
      "lib/closing/providers/types.ts",
      "lib/closing/providers/mockProvider.ts",
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
