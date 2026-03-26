/**
 * Phase 55E — Financial Exception Intelligence CI Guard
 *
 * Suites:
 * 1. Exception builder contract
 * 2. Severity scorer contract
 * 3. Narrative builder contract
 * 4. Override insights contract
 * 5. Decision readiness exception integration
 * 6. API endpoint contract
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
// 1. Exception builder
// ---------------------------------------------------------------------------

describe("Financial exception builder — contract", () => {
  it("buildFinancialExceptions exists", () => {
    assert.ok(fileExists("lib/financialValidation/buildFinancialExceptions.ts"));
  });

  it("produces FinancialException objects with required fields", () => {
    const types = readFile("lib/financialValidation/exception-types.ts");
    assert.ok(types.includes("severity"), "type must include severity");
    assert.ok(types.includes("whyItMatters"), "type must include whyItMatters");
    assert.ok(types.includes("recommendedAction"), "type must include recommendedAction");
    assert.ok(types.includes("committeeDisclosure"), "type must include committeeDisclosure");
    // Builder must use narrative builder and produce the full shape
    const builder = readFile("lib/financialValidation/buildFinancialExceptions.ts");
    assert.ok(builder.includes("buildExceptionNarrative"), "must use narrative builder");
    assert.ok(builder.includes("scoreExceptionSeverity"), "must use severity scorer");
  });

  it("handles all gap types", () => {
    const content = readFile("lib/financialValidation/buildFinancialExceptions.ts");
    assert.ok(content.includes("missing_fact"), "must handle missing_fact");
    assert.ok(content.includes("conflict"), "must handle conflict");
    assert.ok(content.includes("low_confidence"), "must handle low_confidence");
  });

  it("handles resolution audit actions", () => {
    const content = readFile("lib/financialValidation/buildFinancialExceptions.ts");
    assert.ok(content.includes("override_value"), "must handle overrides");
    assert.ok(content.includes("provide_value"), "must handle manual values");
    assert.ok(content.includes("mark_follow_up"), "must handle follow-ups");
  });

  it("handles stale snapshot and post-memo changes", () => {
    const content = readFile("lib/financialValidation/buildFinancialExceptions.ts");
    assert.ok(content.includes("stale_snapshot"), "must handle stale snapshot");
    assert.ok(content.includes("material_change_after_memo"), "must handle post-memo changes");
  });
});

// ---------------------------------------------------------------------------
// 2. Severity scorer
// ---------------------------------------------------------------------------

describe("Exception severity scorer — contract", () => {
  it("scoreFinancialException exists", () => {
    assert.ok(fileExists("lib/financialValidation/scoreFinancialException.ts"));
  });

  it("supports all severity levels", () => {
    const content = readFile("lib/financialValidation/scoreFinancialException.ts");
    for (const s of ["critical", "high", "moderate", "low", "info"]) {
      assert.ok(content.includes(`"${s}"`), `must support severity "${s}"`);
    }
  });

  it("maps fact keys to credit categories", () => {
    const content = readFile("lib/financialValidation/scoreFinancialException.ts");
    assert.ok(content.includes("FACT_CATEGORY_MAP"), "must have category mapping");
    assert.ok(content.includes("cash_flow"), "must map to cash_flow");
    assert.ok(content.includes("debt_service"), "must map to debt_service");
    assert.ok(content.includes("leverage"), "must map to leverage");
  });

  it("identifies decision-critical categories", () => {
    const content = readFile("lib/financialValidation/scoreFinancialException.ts");
    assert.ok(content.includes("DECISION_CRITICAL_CATEGORIES"), "must define critical categories");
  });
});

// ---------------------------------------------------------------------------
// 3. Narrative builder
// ---------------------------------------------------------------------------

describe("Exception narrative builder — contract", () => {
  it("buildExceptionNarrative exists", () => {
    assert.ok(fileExists("lib/financialValidation/buildExceptionNarrative.ts"));
  });

  it("handles all exception kinds", () => {
    const content = readFile("lib/financialValidation/buildExceptionNarrative.ts");
    const kinds = [
      "missing_critical_metric", "unresolved_conflict", "low_confidence_required_fact",
      "stale_snapshot", "banker_override", "manual_provided_value",
      "deferred_follow_up", "material_change_after_memo",
    ];
    for (const k of kinds) {
      assert.ok(content.includes(`"${k}"`), `must handle kind "${k}"`);
    }
  });

  it("returns deterministic narratives (not AI-generated)", () => {
    const content = readFile("lib/financialValidation/buildExceptionNarrative.ts");
    assert.ok(!content.includes("generateText") && !content.includes("callClaude"),
      "must not use AI text generation");
  });
});

// ---------------------------------------------------------------------------
// 4. Override insights
// ---------------------------------------------------------------------------

describe("Override insights — contract", () => {
  it("buildOverrideInsights exists", () => {
    assert.ok(fileExists("lib/financialValidation/buildOverrideInsights.ts"));
  });

  it("computes directionality", () => {
    const content = readFile("lib/financialValidation/buildOverrideInsights.ts");
    assert.ok(content.includes("conservative"), "must compute conservative");
    assert.ok(content.includes("aggressive"), "must compute aggressive");
    assert.ok(content.includes("neutral"), "must compute neutral");
  });

  it("computes materiality", () => {
    const content = readFile("lib/financialValidation/buildOverrideInsights.ts");
    assert.ok(content.includes("material"), "must compute materiality");
    assert.ok(content.includes("MATERIALITY_THRESHOLD"), "must have materiality threshold");
  });

  it("assesses rationale quality", () => {
    const content = readFile("lib/financialValidation/buildOverrideInsights.ts");
    assert.ok(content.includes("rationaleQuality"), "must assess rationale quality");
    assert.ok(content.includes("strong") && content.includes("adequate") && content.includes("weak"),
      "must classify as strong/adequate/weak");
  });

  it("determines committee disclosure requirement", () => {
    const content = readFile("lib/financialValidation/buildOverrideInsights.ts");
    assert.ok(content.includes("requiresCommitteeDisclosure"), "must determine disclosure");
  });
});

// ---------------------------------------------------------------------------
// 5. Decision readiness
// ---------------------------------------------------------------------------

describe("Decision readiness — exception intelligence integration", () => {
  it("accepts exception intelligence inputs", () => {
    const content = readFile("lib/decision/validateDecisionReadiness.ts");
    assert.ok(content.includes("financialExceptionCriticalCount"), "must accept critical count");
    assert.ok(content.includes("financialOverrideDisclosureRequired"), "must accept disclosure flag");
    assert.ok(content.includes("financialMaterialChangeAfterMemo"), "must accept post-memo change");
  });

  it("blocks on material post-memo change", () => {
    const content = readFile("lib/decision/validateDecisionReadiness.ts");
    assert.ok(content.includes("Material financial change occurred after memo"),
      "must block on post-memo material change");
  });

  it("warns on override disclosure requirement", () => {
    const content = readFile("lib/decision/validateDecisionReadiness.ts");
    assert.ok(content.includes("Committee disclosure required for material banker override"),
      "must warn on override disclosure");
  });
});

// ---------------------------------------------------------------------------
// 6. API endpoint
// ---------------------------------------------------------------------------

describe("Financial exceptions API — contract", () => {
  it("endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/financial-exceptions/route.ts"));
  });

  it("uses Clerk auth", () => {
    const content = readFile("app/api/deals/[dealId]/financial-exceptions/route.ts");
    assert.ok(content.includes("requireDealCockpitAccess"), "must use cockpit access");
  });

  it("returns exceptions + overrideInsights + summary", () => {
    const content = readFile("app/api/deals/[dealId]/financial-exceptions/route.ts");
    assert.ok(content.includes("exceptions"), "must return exceptions");
    assert.ok(content.includes("overrideInsights"), "must return overrideInsights");
    assert.ok(content.includes("summary"), "must return summary");
  });
});

// ---------------------------------------------------------------------------
// 7. Placeholder regression
// ---------------------------------------------------------------------------

describe("Financial exception intelligence — no placeholders", () => {
  it("exception modules have no placeholder markers", () => {
    const files = [
      "lib/financialValidation/exception-types.ts",
      "lib/financialValidation/buildFinancialExceptions.ts",
      "lib/financialValidation/scoreFinancialException.ts",
      "lib/financialValidation/buildExceptionNarrative.ts",
      "lib/financialValidation/buildOverrideInsights.ts",
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
