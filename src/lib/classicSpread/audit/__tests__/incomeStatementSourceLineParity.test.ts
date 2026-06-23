/**
 * SPEC-CLASSIC-SPREAD-SOURCE-LINE-MODEL-PARITY-1 — income-statement source-line correctness.
 *
 * Proves the 1120 page-1 model (1a/1b/1c → gross/returns/net), net-sales-correct revenue + gross
 * profit, backward-safe returns inference with a VERIFY_SOURCE_LINE warning, the TOTAL_INCOME guard,
 * and the OBI net-profit / EBITDA basis. Fixtures use OmniCare's numbers as data — no OmniCare-specific
 * code path is hardcoded.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveIncomeStatement1120,
  buildResolvedByPeriod,
  type Facts,
} from "../statementTruthResolver";
import { auditClassicSpread, type AuditInput } from "../spreadAccuracyAudit";
import { classifySpreadFindingAction } from "../spreadFindingActions";
import type { PeriodMaps } from "../../classicSpreadRatios";

const find = <T extends { rowLabel: string; issueType: string }>(fs: T[], label: string, issue?: string): T | undefined =>
  fs.find((f) => f.rowLabel === label && (issue ? f.issueType === issue : true));

const pm = (obj: Record<string, Record<string, number | null>>): PeriodMaps => {
  const m: PeriodMaps = new Map();
  for (const [p, kv] of Object.entries(obj)) m.set(p, new Map(Object.entries(kv)));
  return m;
};
const row = (label: string, values: (number | null)[]) => ({ label, indent: 0, isBold: false, values, showPct: false });

// ── 1120 page-1 model (source-backed line 1a / 1b / 1c) ─────────────────────────────────────────
describe("1120 page-1 model: gross 1a − returns 1b = net 1c, GP = net − COGS", () => {
  const facts: Facts = {
    GROSS_RECEIPTS: 15_088_769, // line 1a
    RETURNS_ALLOWANCES: 323_458, // line 1b
    NET_SALES_REVENUE: 14_765_311, // line 1c
    COST_OF_GOODS_SOLD: 13_292_890, // line 2
    GROSS_PROFIT: 1_472_421, // line 3
  };
  const r = resolveIncomeStatement1120(facts);

  it("models the explicit source lines", () => {
    assert.equal(r.grossReceipts.value, 15_088_769);
    assert.equal(r.returnsAllowances.value, 323_458);
    assert.equal(r.netSales.value, 14_765_311);
    assert.equal(r.cogs.value, 13_292_890);
    assert.equal(r.grossProfit.value, 1_472_421);
  });

  it("a sourced line 1b leaves NO gross-profit blocker and is not an inference", () => {
    assert.equal(r.returnsInferred, false);
    assert.equal(find(r.findings, "GROSS PROFIT", "formula_mismatch"), undefined);
    assert.equal(find(r.findings, "Sales / Revenues"), undefined);
  });
});

// ── #3 backward-safe inference (no line 1b) ─────────────────────────────────────────────────────
describe("returns/allowances inferred when line 1b is missing", () => {
  const facts: Facts = {
    GROSS_RECEIPTS: 15_088_769,
    COST_OF_GOODS_SOLD: 13_292_890,
    GROSS_PROFIT: 1_472_421,
  };
  const r = resolveIncomeStatement1120(facts);

  it("infers returns = 323,458 and net sales = 14,765,311", () => {
    assert.equal(r.returnsInferred, true);
    assert.equal(r.returnsAllowances.value, 323_458); // 15,088,769 − 13,292,890 − 1,472,421
    assert.equal(r.netSales.value, 14_765_311);
    assert.equal(r.returnsAllowances.basis, "derived");
  });

  it("keeps a VERIFY_SOURCE_LINE warning (not clean, not a GP blocker)", () => {
    assert.equal(find(r.findings, "GROSS PROFIT", "formula_mismatch"), undefined);
    const v = find(r.findings, "Sales / Revenues", "formula_mismatch");
    assert.ok(v, "inferred returns must surface a finding");
    assert.equal(v!.severity, "warning");
    assert.equal(classifySpreadFindingAction({
      period: "2023", statement: "income_statement", rowLabel: v!.rowLabel, issueType: v!.issueType,
      expectedValue: v!.expectedValue, actualValue: v!.actualValue, difference: v!.difference,
      tolerance: 1, sourceFactIds: [], documentIds: [], severity: v!.severity, detail: v!.detail,
    }).action, "VERIFY_SOURCE_LINE");
  });
});

// ── #2 revenue is rendered from NET sales, never gross receipts / TOTAL_INCOME ──────────────────
describe("Sales / Revenues renders resolved net sales, not gross receipts", () => {
  it("the resolved overlay injects NET_SALES_REVENUE = net (gross − inferred returns)", () => {
    const byPeriod = pm({ "2023-12-31": { GROSS_RECEIPTS: 15_088_769, COST_OF_GOODS_SOLD: 13_292_890, GROSS_PROFIT: 1_472_421 } });
    const overlay = buildResolvedByPeriod(byPeriod, ["2023-12-31"]);
    assert.equal(overlay.get("2023-12-31")!.get("NET_SALES_REVENUE"), 14_765_311);
    // the loader's revenue fallback reads NET_SALES_REVENUE before GROSS_RECEIPTS → renders net, not gross.
    assert.notEqual(overlay.get("2023-12-31")!.get("NET_SALES_REVENUE"), 15_088_769);
  });

  it("TOTAL_INCOME never satisfies revenue or gross profit", () => {
    const r = resolveIncomeStatement1120({ TOTAL_INCOME: 282_742 });
    assert.equal(r.revenue.value, null);
    assert.equal(r.netSales.value, null);
    assert.equal(r.grossProfit.value, null);
    assert.ok(find(r.findings, "GROSS PROFIT", "formula_mismatch"));
  });
});

// ── GP audit: with returns present (incl. inferred), no GP blocker ──────────────────────────────
describe("audit GROSS PROFIT reconciles against net sales", () => {
  const baseInput = (extra: Record<string, number>): AuditInput => ({
    periods: [{ iso: "2023-12-31", label: "2023" }],
    byPeriod: pm({ "2023-12-31": { GROSS_RECEIPTS: 15_088_769, COST_OF_GOODS_SOLD: 13_292_890, GROSS_PROFIT: 1_472_421, NET_INCOME: 200_000, ...extra } }),
    balanceSheet: [],
    incomeStatement: [row("GROSS PROFIT", [1_472_421]), row("NET PROFIT", [200_000])],
    cashFlow: [],
    resolve: true,
  });

  it("inferred returns → no GROSS PROFIT blocker", () => {
    const r = auditClassicSpread(baseInput({}));
    assert.equal(r.findings.filter((f) => f.rowLabel === "GROSS PROFIT" && f.severity === "blocker").length, 0);
  });

  it("sourced line 1b → no GROSS PROFIT finding at all", () => {
    const r = auditClassicSpread(baseInput({ RETURNS_ALLOWANCES: 323_458 }));
    assert.equal(r.findings.filter((f) => f.rowLabel === "GROSS PROFIT").length, 0);
  });
});

// ── #4 OBI net-profit / EBITDA basis ────────────────────────────────────────────────────────────
describe("net profit / EBITDA basis prefers OBI over a zero NET_INCOME", () => {
  const facts: Facts = {
    NET_INCOME: 0, // direct bottom line is zero/blank on the return
    ORDINARY_BUSINESS_INCOME: 200_925,
    INTEREST_EXPENSE: 0,
    DEPRECIATION: 210_207,
    AMORTIZATION: 0,
  };
  const r = resolveIncomeStatement1120(facts);

  it("resolves net profit to OBI (200,925) and warns the zero NET_INCOME was bypassed", () => {
    assert.equal(r.netProfit.value, 200_925);
    assert.equal(r.netProfit.basis, "derived");
    const f = find(r.findings, "NET PROFIT", "rejected_source_value");
    assert.ok(f);
    assert.equal(f!.severity, "warning");
    assert.equal(f!.rejectedSource!.key, "NET_INCOME");
  });

  it("the overlay feeds OBI into NET_INCOME so EBIT = 200,925 and EBITDA = 411,132", () => {
    const overlay = buildResolvedByPeriod(pm({ "2024-12-31": facts as Record<string, number | null> }), ["2024-12-31"]);
    const m = overlay.get("2024-12-31")!;
    const ni = m.get("NET_INCOME")!;
    assert.equal(ni, 200_925);
    // loader formulae: EBIT = NI + interest; EBITDA = NI + interest + dep + amort.
    const ebit = ni + (m.get("INTEREST_EXPENSE") ?? 0);
    const ebitda = ni + (m.get("INTEREST_EXPENSE") ?? 0) + (m.get("DEPRECIATION") ?? 0) + (m.get("AMORTIZATION") ?? 0);
    assert.equal(ebit, 200_925);
    assert.equal(ebitda, 411_132);
  });

  it("a real NET_INCOME loss is NOT overridden by OBI", () => {
    const loss = resolveIncomeStatement1120({ NET_INCOME: -40_000, ORDINARY_BUSINESS_INCOME: 200_925 });
    assert.equal(loss.netProfit.value, -40_000);
    assert.equal(loss.netProfit.basis, "direct");
    assert.equal(find(loss.findings, "NET PROFIT", "rejected_source_value"), undefined);
  });
});
