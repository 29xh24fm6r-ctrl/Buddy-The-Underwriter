import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  certifyRatio,
  certifyRatios,
  RATIO_CLASS,
  type RatioOperand,
  type RatioCertInput,
  type DenominatorKind,
} from "../certifiedRatios";

/**
 * SPEC-CLASSIC-SPREAD-RATIO-CERTIFICATION-1 (Phase 5) — ratios certify only when the identity,
 * denominator and dependencies are safe; mislabeled/mathematically-unsafe ratios are blocked.
 */

function op(over: Partial<RatioOperand>): RatioOperand {
  return {
    id: Math.random().toString(36).slice(2),
    factKey: "CASH_FLOW_AVAILABLE",
    value: 205_112,
    period: "2024-12-31",
    documentId: "doc",
    canonicalType: null,
    confidence: 0.85,
    extractor: "runCashFlowAggregator:v2",
    is_superseded: false,
    resolution_status: "inferred",
    ...over,
  };
}
function den(value: number, kind: DenominatorKind, over: Partial<RatioOperand> = {}): RatioOperand & { kind: DenominatorKind } {
  return { ...op({ factKey: "ANNUAL_DEBT_SERVICE", value, period: "2024-12-31", ...over }), kind };
}

describe("certifiedRatios — identity / labeling", () => {
  it("interest coverage certifies as interest_coverage, never DSCR", () => {
    const c = certifyRatio({
      ratioType: "INTEREST_COVERAGE",
      numerator: op({ factKey: "EBIT", value: 268_000 }),
      denominator: den(100_000, "interest_expense", { factKey: "INTEREST_EXPENSE" }),
    });
    assert.equal(c.value.status, "certified");
    assert.equal(c.ratioClass, "interest_coverage");
    assert.equal(c.value.formulaName, "INTEREST_COVERAGE");
    assert.notEqual(RATIO_CLASS[c.ratioType], "historical");
  });

  it("DSCR cannot substitute interest expense for annual debt service", () => {
    const c = certifyRatio({
      ratioType: "DSCR_TRADITIONAL",
      numerator: op({ value: 205_112 }),
      denominator: den(100_000, "interest_expense", { factKey: "INTEREST_EXPENSE" }),
    });
    assert.equal(c.value.status, "blocked");
    assert.match(c.reason, /interest expense/);
  });

  it("proposed debt service cannot certify as historical DSCR", () => {
    const c = certifyRatio({
      ratioType: "DSCR_TRADITIONAL",
      numerator: op({ value: 205_112 }),
      denominator: den(101_250, "proposed_debt_service", { factKey: "ANNUAL_DEBT_SERVICE_PROPOSED" }),
    });
    assert.equal(c.value.status, "blocked");
    assert.match(c.reason, /proposed debt service/);
  });

  it("proposed/pro-forma coverage is labeled proposed and certifies with proposed debt service", () => {
    const c = certifyRatio({
      ratioType: "DSCR_PROPOSED",
      numerator: op({ value: 205_112 }),
      denominator: den(101_250, "proposed_debt_service", { factKey: "ANNUAL_DEBT_SERVICE_PROPOSED" }),
    });
    assert.equal(c.value.status, "certified");
    assert.equal(c.ratioClass, "proposed");
  });

  it("UCA DSCR and recurring/NCADS DSCR remain distinct classes", () => {
    const uca = certifyRatio({ ratioType: "DSCR_UCA", numerator: op({ factKey: "UCA_CFO", value: 250_000 }), denominator: den(100_000, "annual_debt_service") });
    const ncads = certifyRatio({ ratioType: "DSCR_NCADS", numerator: op({ factKey: "NCADS", value: 220_000 }), denominator: den(100_000, "annual_debt_service") });
    assert.equal(uca.ratioClass, "uca");
    assert.equal(ncads.ratioClass, "ncads");
    assert.notEqual(uca.ratioClass, ncads.ratioClass);
    assert.equal(uca.value.formulaName, "DSCR_UCA");
    assert.equal(ncads.value.formulaName, "DSCR_NCADS");
  });
});

describe("certifiedRatios — denominator safety", () => {
  it("DSCR without annual debt service is unavailable", () => {
    const c = certifyRatio({
      ratioType: "DSCR_TRADITIONAL",
      numerator: op({ value: 205_112 }),
      denominator: den(0, "annual_debt_service", { value: null as unknown as number }),
    });
    assert.equal(c.value.status, "unavailable");
  });

  it("DSCR with annual debt service = 0 is blocked, not infinite/clean", () => {
    const c = certifyRatio({
      ratioType: "DSCR_TRADITIONAL",
      numerator: op({ value: 205_112 }),
      denominator: den(0, "annual_debt_service"),
    });
    assert.equal(c.value.status, "blocked");
    assert.equal(c.value.value, null);
    assert.match(c.reason, /zero/);
  });

  it("DSCR with a sentinel-period annual debt service is blocked (untrusted denominator)", () => {
    const c = certifyRatio({
      ratioType: "DSCR_TRADITIONAL",
      numerator: op({ value: 205_112 }),
      denominator: den(101_250, "annual_debt_service", { period: "1900-01-01" }),
    });
    assert.equal(c.value.status, "blocked");
    assert.match(c.reason, /sentinel|untrusted/);
  });
});

describe("certifiedRatios — recompute / tolerance", () => {
  it("certifies when reported ratio reconciles with the recomputed value", () => {
    // 250,000 / 100,000 = 2.5; reported 2.49 within tolerance
    const c = certifyRatio({
      ratioType: "DSCR_NCADS",
      numerator: op({ value: 250_000 }),
      denominator: den(100_000, "annual_debt_service"),
      reportedRatio: op({ factKey: "GCF_DSCR", value: 2.49, period: "2024-12-31" }),
    });
    assert.equal(c.value.status, "certified");
    assert.equal(c.toleranceOk, true);
    assert.ok(Math.abs((c.computedRatio ?? 0) - 2.5) < 1e-9);
  });

  it("blocks a material reported-vs-computed mismatch", () => {
    const c = certifyRatio({
      ratioType: "DSCR_NCADS",
      numerator: op({ value: 250_000 }),
      denominator: den(100_000, "annual_debt_service"),
      reportedRatio: op({ factKey: "GCF_DSCR", value: 1.02, period: "2024-12-31" }),
    });
    assert.equal(c.value.status, "blocked");
    assert.equal(c.toleranceOk, false);
    assert.ok(c.rejected.some((r) => r.value === 1.02));
  });
});

describe("certifiedRatios — dependency gate + lifecycle + audit + purity", () => {
  const okInput = (): RatioCertInput => ({
    ratioType: "DSCR_NCADS",
    numerator: op({ value: 250_000 }),
    denominator: den(100_000, "annual_debt_service"),
  });

  it("blocked GCF dependency blocks the ratio", () => {
    const c = certifyRatio({ ...okInput(), numeratorDependency: "blocked" });
    assert.equal(c.value.status, "blocked");
    assert.match(c.reason, /dependency blocked/);
  });

  it("preliminary GCF dependency makes the ratio preliminary/limited", () => {
    const c = certifyRatio({ ...okInput(), numeratorDependency: "preliminary" });
    assert.equal(c.value.status, "certified");
    assert.equal(c.preliminary, true);
    assert.ok(c.value.caveats.some((x) => /Preliminary/.test(x)));
  });

  it("superseded / rejected / system_invalidated operands are ignored (treated absent)", () => {
    const sup = certifyRatio({ ratioType: "DSCR_TRADITIONAL", numerator: op({ value: 205_112 }), denominator: den(100_000, "annual_debt_service", { is_superseded: true }) });
    assert.equal(sup.value.status, "unavailable"); // denominator filtered → no DSCR
    const rej = certifyRatio({ ratioType: "DSCR_TRADITIONAL", numerator: op({ value: 205_112, resolution_status: "rejected" }), denominator: den(100_000, "annual_debt_service") });
    assert.equal(rej.value.status, "unavailable"); // numerator filtered
  });

  it("audit includes numerator, denominator, computed/reported ratio, dependency status and ratio type", () => {
    const { certifications, auditRows } = certifyRatios(
      [{ ratioType: "DSCR_NCADS", numerator: op({ value: 250_000 }), denominator: den(100_000, "annual_debt_service"), reportedRatio: op({ factKey: "GCF_DSCR", value: 2.49 }), numeratorDependency: "ok" }],
      "2024-12-31",
    );
    const c = certifications[0];
    assert.equal(c.ratioType, "DSCR_NCADS");
    assert.equal(c.numerator.value, 250_000);
    assert.equal(c.denominator.value, 100_000);
    assert.equal(c.denominator.kind, "annual_debt_service");
    assert.ok(Math.abs((c.computedRatio ?? 0) - 2.5) < 1e-9);
    assert.equal(c.reportedRatio, 2.49);
    assert.equal(c.dependencyStatus, "ok");
    assert.equal(auditRows[0].page, "ratios");
    assert.equal(auditRows[0].row, "DSCR_NCADS");
  });

  it("certifiedRatios.ts does not import or call reconcileFinancialFacts", () => {
    const code = fs
      .readFileSync("src/lib/classicSpread/certification/certifiedRatios.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(!/\bimport\b[\s\S]*?reconcileFinancialFacts/.test(code));
    assert.ok(!/reconcileFinancialFacts\s*\(/.test(code));
    assert.ok(!/from\s+["'][^"']*certifyFactSelection["']/.test(code));
  });
});
