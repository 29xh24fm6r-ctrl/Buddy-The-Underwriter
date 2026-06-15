import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveBalanceSheet,
  resolveIncomeStatement1120,
  buildResolvedByPeriod,
  type Facts,
} from "../statementTruthResolver";
import { deriveTotalLiabilities, deriveTotalCurrentLiabilities, deriveTotalNonCurrentLiabilities, type PeriodMaps } from "../../classicSpreadRatios";
import { classifySpreadFindingAction } from "../spreadFindingActions";
import { auditClassicSpread } from "../spreadAccuracyAudit";

function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}
const ov = (m: PeriodMaps, p: string, k: string) => m.get(p)!.get(k) ?? null;
const find = <T extends { rowLabel: string; issueType: string }>(fs: T[], label: string, issue?: string): T | undefined =>
  fs.find((f) => f.rowLabel === label && (issue ? f.issueType === issue : true));

// ── #1 liability-side parity ──────────────────────────────────────────────────────────────────
describe("#1 liability-side parity — TL is never less than TCL", () => {
  // OmniCare 2025: direct TCL 140,451 (incl OCL), bad direct TL 102,336, no non-current liabilities.
  const facts2025: Facts = {
    SL_CASH: 739_144, SL_AR_GROSS: 2_393_922, SL_TOTAL_ASSETS: 3_342_586,
    SL_ACCOUNTS_PAYABLE: 110_000, SL_TOTAL_CURRENT_LIABILITIES: 140_451, SL_TOTAL_LIABILITIES: 102_336,
    SL_TOTAL_EQUITY: 3_202_135,
  };
  const r = resolveBalanceSheet(facts2025);

  it("resolves TCL 140,451, TNCL 0, TL 140,451 (>= TCL)", () => {
    assert.equal(r.totalCurrentLiabilities.value, 140_451);
    assert.equal(r.totalNonCurrentLiabilities.value, 0);
    assert.equal(r.totalLiabilities.value, 140_451);
    assert.ok(r.totalLiabilities.value! >= r.totalCurrentLiabilities.value!);
  });

  it("TL + NW balances to Total Assets", () => {
    assert.equal(r.totalLiabilitiesAndEquity.value, 3_342_586);
    assert.equal(find(r.findings, "TOTAL LIABILITIES & NET WORTH", "unreconciled_total"), undefined);
  });

  it("keeps a warning that direct TCL exceeds visible components (unmapped OCL)", () => {
    const f = find(r.findings, "TOTAL CURRENT LIABILITIES", "contradictory_components");
    assert.ok(f);
    assert.equal(f!.severity, "warning");
  });

  it("the TL<TCL correction is a warning, not a blocker", () => {
    const f = find(r.findings, "TOTAL LIABILITIES", "rejected_source_value");
    assert.ok(f);
    assert.equal(f!.severity, "warning");
  });

  it("rendered liability rows (via overlay + derivations) show TCL=TL=140,451, TNCL=0", () => {
    const byPeriod = pm({ "2025-12-31": facts2025 });
    const resolved = buildResolvedByPeriod(byPeriod, ["2025-12-31"]);
    assert.equal(ov(resolved, "2025-12-31", "SL_TOTAL_LIABILITIES"), 140_451); // corrected from 102,336
    assert.equal(deriveTotalCurrentLiabilities(resolved, ["2025-12-31"])[0], 140_451);
    assert.equal(deriveTotalLiabilities(resolved, ["2025-12-31"])[0], 140_451);
    assert.equal(deriveTotalNonCurrentLiabilities(resolved, ["2025-12-31"])[0], 0);
  });
});

describe("#1 YTD 2026 liability parity", () => {
  const facts2026: Facts = {
    SL_TOTAL_ASSETS: 3_501_691, SL_ACCOUNTS_PAYABLE: 60_000,
    SL_TOTAL_CURRENT_LIABILITIES: 94_444, SL_TOTAL_LIABILITIES: 61_995, SL_TOTAL_EQUITY: 3_407_247,
  };
  it("TCL 94,444, TNCL 0, TL 94,444, TL+NW balances", () => {
    const r = resolveBalanceSheet(facts2026);
    assert.equal(r.totalCurrentLiabilities.value, 94_444);
    assert.equal(r.totalNonCurrentLiabilities.value, 0);
    assert.equal(r.totalLiabilities.value, 94_444);
    assert.equal(r.totalLiabilitiesAndEquity.value, 3_501_691);
  });
});

// ── #2 1120 income lines ──────────────────────────────────────────────────────────────────────
describe("#2 1120 income-line model", () => {
  it("models gross_receipts/returns/net_sales/COGS/gross_profit/total_income explicitly", () => {
    const r = resolveIncomeStatement1120({ GROSS_RECEIPTS: 1_000_000, RETURNS_ALLOWANCES: 50_000, COST_OF_GOODS_SOLD: 600_000, GROSS_PROFIT: 350_000, TOTAL_INCOME: 380_000 });
    assert.equal(r.grossReceipts.value, 1_000_000);
    assert.equal(r.returnsAllowances.value, 50_000);
    assert.equal(r.netSales.value, 950_000);
    assert.equal(r.cogs.value, 600_000);
    assert.equal(r.grossProfit.value, 350_000); // foots: 950,000 − 600,000
    assert.equal(r.totalIncome.value, 380_000);
    assert.equal(find(r.findings, "GROSS PROFIT", "formula_mismatch"), undefined);
  });

  it("a missing-returns GP conflict stays a blocker; GP is sourced directly, not from total income", () => {
    const r = resolveIncomeStatement1120({ GROSS_RECEIPTS: 1_000_000, COST_OF_GOODS_SOLD: 600_000, GROSS_PROFIT: 350_000, TOTAL_INCOME: 380_000 });
    assert.equal(r.grossProfit.basis, "direct"); // from GROSS_PROFIT line, never TOTAL_INCOME
    assert.notEqual(r.grossProfit.value, r.totalIncome.value);
    const f = find(r.findings, "GROSS PROFIT", "formula_mismatch");
    assert.ok(f);
    assert.equal(f!.severity, "blocker");
  });

  it("GROSS_PROFIT is never sourced from TOTAL_INCOME when no sales/COGS exist", () => {
    const r = resolveIncomeStatement1120({ TOTAL_INCOME: 282_742 });
    assert.equal(r.grossProfit.value, null);
    assert.ok(find(r.findings, "GROSS PROFIT", "formula_mismatch"));
  });
});

// ── #3 action model ───────────────────────────────────────────────────────────────────────────
describe("#3 finding -> action classification", () => {
  const mk = (issueType: string, severity = "blocker", detail = "") => ({
    period: "2024", statement: "balance_sheet" as const, rowLabel: "X", issueType: issueType as any,
    expectedValue: null, actualValue: null, difference: null, tolerance: 1, sourceFactIds: [], documentIds: [], severity: severity as any, detail,
  });
  it("maps each blocker class to its action", () => {
    assert.equal(classifySpreadFindingAction(mk("rejected_source_value", "blocker", "rejected SL_TOTAL_EQUITY")).action, "CONFIRM_RESOLVED_VALUE");
    assert.equal(classifySpreadFindingAction(mk("missing_implied_component")).action, "REQUEST_SOURCE_DETAIL");
    assert.equal(classifySpreadFindingAction(mk("formula_mismatch")).action, "VERIFY_SOURCE_LINE");
    assert.equal(classifySpreadFindingAction(mk("contradictory_components", "warning")).action, "REQUEST_SOURCE_DETAIL");
    assert.equal(classifySpreadFindingAction(mk("derived_from_fallback", "info")).action, "ACCEPT_AS_REPORTED");
  });
  it("extracts the rejected source key", () => {
    assert.equal(classifySpreadFindingAction(mk("rejected_source_value", "blocker", "Direct ... rejected SL_TOTAL_EQUITY = 6800000")).rejectedSourceKey, "SL_TOTAL_EQUITY");
  });
});

// ── #4 action summary ─────────────────────────────────────────────────────────────────────────
describe("#4 grouped action summary on the audit result", () => {
  it("groups by period/action and counts unresolved actions; OmniCare 2024 stays BLOCKER", () => {
    const r = auditClassicSpread({
      periods: [{ iso: "2024-12-31", label: "2024" }],
      byPeriod: pm({ "2024-12-31": { SL_TOTAL_ASSETS: 6_800_000, SL_ACCOUNTS_PAYABLE: 71_364, SL_LOANS_FROM_SHAREHOLDERS: 1_930_705, SL_OTHER_LIABILITIES: 284_993, SL_RETAINED_EARNINGS: 4_512_938, SL_TOTAL_EQUITY: 6_800_000 } }),
      balanceSheet: [], incomeStatement: [], cashFlow: [], resolve: true,
    });
    assert.equal(r.status, "blocker");
    assert.ok(r.actionSummary.unresolvedActionCount >= 1);
    assert.ok((r.actionSummary.byAction["CONFIRM_RESOLVED_VALUE"] ?? 0) >= 1); // the rejected equity
    assert.ok((r.actionSummary.byPeriod["2024"] ?? 0) >= 1);
  });
});
