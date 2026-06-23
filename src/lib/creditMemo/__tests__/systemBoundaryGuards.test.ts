/**
 * SYSTEM_BOUNDARY_GUARD_V1
 *
 * Prevents competing memo scoring/rating/decision systems from developing.
 * These guards fail if architectural boundaries are violated.
 *
 * Pure test — reads source files, no server-only imports.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, "../../../..", relativePath), "utf-8");
}

// ══════════════════════════════════════════════════════════════════════════
// Guard 1: buildCanonicalCreditMemo must NOT import computeDealScore
// ══════════════════════════════════════════════════════════════════════════

describe("BOUNDARY §1 — Memo builder does not use legacy score model", () => {
  it("buildCanonicalCreditMemo does not import computeDealScore", () => {
    const src = readSource("src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts");
    // Allow comments referencing it, but not actual import statements
    const importLines = src.split("\n").filter((line) => {
      return line.includes("computeDealScore") && line.trimStart().startsWith("import");
    });
    assert.equal(importLines.length, 0, `Found active computeDealScore import: ${importLines.join("\n")}`);
  });

  it("buildCanonicalCreditMemo does not call computeDealScore()", () => {
    const src = readSource("src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts");
    // Check non-comment lines for function calls
    const activeLines = src.split("\n").filter((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
      return trimmed.includes("computeDealScore(") || trimmed.includes("computeDealScore ({");
    });
    assert.equal(activeLines.length, 0, `Found computeDealScore() call: ${activeLines.join("\n")}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 2: CanonicalMemoTemplate must NOT render legacy score
// ══════════════════════════════════════════════════════════════════════════

describe("BOUNDARY §2 — Template does not render legacy score", () => {
  it("CanonicalMemoTemplate does not reference deal_underwriting_scores", () => {
    const src = readSource("src/components/creditMemo/CanonicalMemoTemplate.tsx");
    assert.ok(!src.includes("deal_underwriting_scores"), "Template must not reference deal_underwriting_scores table");
  });

  it("CanonicalMemoTemplate does not import computeDealScore", () => {
    const src = readSource("src/components/creditMemo/CanonicalMemoTemplate.tsx");
    assert.ok(!src.includes("computeDealScore"), "Template must not reference computeDealScore");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 3: Conventional risk rating is the memo-facing grade source
// ══════════════════════════════════════════════════════════════════════════

describe("BOUNDARY §3 — Conventional rating is memo-facing", () => {
  it("buildCanonicalCreditMemo imports buildConventionalRiskRating", () => {
    const src = readSource("src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts");
    assert.ok(src.includes("buildConventionalRiskRating"), "Memo builder must use conventional rating");
  });

  it("conventional rating produces grade on 1-8 scale, not A-D", () => {
    const { buildConventionalRiskRating } = require("@/lib/creditMemo/riskRating/buildConventionalRiskRating");
    const result = buildConventionalRiskRating({
      dscr: 2.0, stressedDscr: 1.5, worstYearDscr: 1.8,
      cfadsTrend: "flat", revenueTrend: "flat",
      ltvPct: 65, collateralCoverageRatio: 1.5,
      arBorrowingBaseAvailable: false,
      guarantorNetWorth: 1_000_000,
      currentRatio: 1.5, debtToEquity: 2.0, grossMarginPct: 0.25,
      managementYearsExperience: 10, characterScore: 4,
      gcfComplete: true, formalDiligenceComplete: true,
      customerConcentrationRisk: false, hasAdverseFindings: false,
      financialStatementQuality: "reviewed",
    });
    assert.ok(typeof result.risk_grade === "number", "Grade must be numeric");
    assert.ok(result.risk_grade >= 1 && result.risk_grade <= 8, `Grade must be 1-8, got ${result.risk_grade}`);
    assert.ok(result.risk_grade_scale === "Conventional 1–8", `Scale must be Conventional 1-8, got ${result.risk_grade_scale}`);
    assert.ok(!["A", "B", "C", "D"].includes(result.risk_grade_label), "Label must not be A-D letter grade");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 4: Narrative overlays are input-hash gated
// ══════════════════════════════════════════════════════════════════════════

describe("BOUNDARY §4 — Narrative overlay hash gating", () => {
  it("canonical page has input_hash gating", () => {
    const src = readSource("src/app/(app)/credit-memo/[dealId]/canonical/page.tsx");
    assert.ok(src.includes("input_hash"), "Canonical page must reference input_hash");
    assert.ok(src.includes("narrativeIsFresh") || src.includes("currentInputHash"), "Must compute/check hash freshness");
  });

  it("canonical print page has input_hash gating", () => {
    const src = readSource("src/app/(app)/credit-memo/[dealId]/canonical/print/page.tsx");
    assert.ok(src.includes("input_hash"), "Print page must reference input_hash");
    assert.ok(src.includes("narrativeIsFresh") || src.includes("currentInputHash"), "Must compute/check hash freshness");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 5: Frozen snapshot is immutable and uses canonical memo
// ══════════════════════════════════════════════════════════════════════════

describe("BOUNDARY §5 — Frozen snapshot integrity", () => {
  it("SubmittedMemoView renders CanonicalMemoTemplate for frozen snapshots", () => {
    const src = readSource("src/components/creditMemo/SubmittedMemoView.tsx");
    assert.ok(src.includes("CanonicalMemoTemplate"), "Frozen view must render via CanonicalMemoTemplate");
    assert.ok(src.includes("snapshot.canonical_memo"), "Must read from frozen canonical_memo");
  });

  it("buildFloridaArmorySnapshot embeds canonical_memo", () => {
    const src = readSource("src/lib/creditMemo/snapshot/buildFloridaArmorySnapshot.ts");
    assert.ok(src.includes("canonical_memo: canonicalMemo"), "Snapshot must embed canonical_memo");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 6: No duplicate scoring systems in memo pipeline
// ══════════════════════════════════════════════════════════════════════════

describe("BOUNDARY §6 — Single scoring system for memo", () => {
  it("snapshot builder does not import computeDealScore", () => {
    const src = readSource("src/lib/creditMemo/snapshot/buildFloridaArmorySnapshot.ts");
    assert.ok(!src.includes("computeDealScore"), "Snapshot builder must not use legacy score");
  });

  it("submission orchestrator does not import computeDealScore", () => {
    const src = readSource("src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts");
    assert.ok(!src.includes("computeDealScore"), "Submit orchestrator must not use legacy score");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 7: Regression — conventional rating OmniCare profile
// ══════════════════════════════════════════════════════════════════════════

describe("BOUNDARY §7 — OmniCare profile does not produce D", () => {
  it("strong DSCR + AR + guarantor + incomplete GCF → grade 3-5, not 7-8", () => {
    const { buildConventionalRiskRating } = require("@/lib/creditMemo/riskRating/buildConventionalRiskRating");
    const r = buildConventionalRiskRating({
      dscr: 7.12, stressedDscr: 4.93, worstYearDscr: 2.03,
      cfadsTrend: "down", revenueTrend: "down",
      ltvPct: 49.88, collateralCoverageRatio: 1.60,
      arBorrowingBaseAvailable: true,
      guarantorNetWorth: 24_840_000,
      currentRatio: 4.5, debtToEquity: 0.11, grossMarginPct: 0.136,
      managementYearsExperience: 25, characterScore: 4,
      gcfComplete: false, formalDiligenceComplete: false,
      customerConcentrationRisk: true, hasAdverseFindings: false,
      financialStatementQuality: "tax_returns",
    });
    assert.ok(r.risk_grade >= 3 && r.risk_grade <= 5, `OmniCare should be 3-5, got ${r.risk_grade} — ${r.risk_grade_label}`);
    assert.ok(r.risk_grade_label !== "Substandard" && r.risk_grade_label !== "Doubtful", "Must not be Substandard/Doubtful");
  });
});
