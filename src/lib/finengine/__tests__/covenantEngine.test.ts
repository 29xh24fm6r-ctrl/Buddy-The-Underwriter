/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 16 tests.
 *
 * Recommendations vary by product/risk; four-state evaluation covers pass,
 * warning, breach, and missing data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  recommendCovenantPackage,
  evaluateFinancialCovenant,
  evaluateReportingCovenant,
  type ManagedCovenant,
} from "@/lib/finengine/covenants/covenantEngine";

describe("PR16 — recommendations vary by product/risk", () => {
  it("ABL product gets borrowing-base + AR aging covenants", () => {
    const pkg = recommendCovenantPackage({ product: "ABL_REVOLVER", riskLevel: "moderate", underwrittenDscr: 1.4 });
    const types = pkg.map((c) => c.type);
    assert.ok(types.includes("BORROWING_BASE"));
    assert.ok(types.includes("AR_AGING"));
  });

  it("CI term does NOT get a borrowing base", () => {
    const pkg = recommendCovenantPackage({ product: "CI_TERM", riskLevel: "low", underwrittenDscr: 1.5 });
    assert.ok(!pkg.some((c) => c.type === "BORROWING_BASE"));
    assert.ok(pkg.some((c) => c.type === "FCCR")); // CI term gets FCCR
  });

  it("elevated risk tightens DSCR cushion + adds distribution + deposit covenants", () => {
    const low = recommendCovenantPackage({ product: "CI_TERM", riskLevel: "low", underwrittenDscr: 1.5 });
    const elevated = recommendCovenantPackage({ product: "CI_TERM", riskLevel: "elevated", underwrittenDscr: 1.5 });
    const lowDscr = low.find((c) => c.type === "DSCR")!.threshold!;
    const elevatedDscr = elevated.find((c) => c.type === "DSCR")!.threshold!;
    assert.ok(elevatedDscr > lowDscr, "elevated cushion is tighter → higher floor");
    assert.ok(elevated.some((c) => c.type === "DISTRIBUTION_LIMITATION"));
    assert.ok(elevated.some((c) => c.type === "DEPOSIT_COVENANT"));
    assert.ok(!low.some((c) => c.type === "DISTRIBUTION_LIMITATION"));
  });

  it("elevated ABL reports monthly, moderate quarterly", () => {
    const mod = recommendCovenantPackage({ product: "ABL_REVOLVER", riskLevel: "moderate", underwrittenDscr: 1.3 });
    const elev = recommendCovenantPackage({ product: "ABL_REVOLVER", riskLevel: "elevated", underwrittenDscr: 1.3 });
    assert.equal(mod.find((c) => c.type === "BORROWING_BASE")!.cadence, "quarterly");
    assert.equal(elev.find((c) => c.type === "BORROWING_BASE")!.cadence, "monthly");
  });
});

describe("PR16 — four-state evaluation", () => {
  const dscrFloor: ManagedCovenant = { type: "DSCR", kind: "financial", direction: "floor", threshold: 1.2, rationale: "" };
  const leverageCap: ManagedCovenant = { type: "LEVERAGE", kind: "financial", direction: "cap", threshold: 3.0, rationale: "" };

  it("pass — comfortably above floor", () => {
    assert.equal(evaluateFinancialCovenant(dscrFloor, 1.5).status, "pass");
  });
  it("warning — just above floor (within cushion)", () => {
    assert.equal(evaluateFinancialCovenant(dscrFloor, 1.23).status, "warning");
  });
  it("breach — below floor, with severity", () => {
    const e = evaluateFinancialCovenant(dscrFloor, 0.9);
    assert.equal(e.status, "breach");
    assert.equal(e.severity, "severe"); // 25% below
  });
  it("no_data — null actual", () => {
    assert.equal(evaluateFinancialCovenant(dscrFloor, null).status, "no_data");
  });

  it("cap covenant — breach when actual exceeds cap", () => {
    assert.equal(evaluateFinancialCovenant(leverageCap, 3.5).status, "breach");
    assert.equal(evaluateFinancialCovenant(leverageCap, 2.0).status, "pass");
    assert.equal(evaluateFinancialCovenant(leverageCap, 2.95).status, "warning");
  });

  it("minor vs material breach severity scales with magnitude", () => {
    assert.equal(evaluateFinancialCovenant(dscrFloor, 1.18).severity, "minor"); // ~1.7% below
    assert.equal(evaluateFinancialCovenant(dscrFloor, 1.1).severity, "material"); // ~8% below
  });
});

describe("PR16 — reporting covenant evaluation", () => {
  const bb: ManagedCovenant = { type: "BORROWING_BASE", kind: "reporting", direction: "event", cadence: "monthly", rationale: "" };
  it("delivered → pass, missing → breach, unknown → no_data", () => {
    assert.equal(evaluateReportingCovenant(bb, true).status, "pass");
    assert.equal(evaluateReportingCovenant(bb, false).status, "breach");
    assert.equal(evaluateReportingCovenant(bb, null).status, "no_data");
  });
});
