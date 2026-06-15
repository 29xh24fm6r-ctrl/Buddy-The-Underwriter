import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { auditClassicSpread, type AuditInput } from "../spreadAccuracyAudit";
import type { PeriodMaps } from "../../classicSpreadRatios";
import type { FinancialRow } from "../../types";

/**
 * SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1 — OmniCare-shaped red-flag detection.
 *
 * The audit compares the RENDERED rows (post-certification suppression) against the SOURCE facts
 * (byPeriod) the spread was built from, and must surface every incompleteness / inaccuracy.
 */

function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}
function row(label: string, values: (number | null)[]): FinancialRow {
  return { label, indent: 0, isBold: true, values, showPct: false };
}
const find = (r: ReturnType<typeof auditClassicSpread>, label: string, issue?: string) =>
  r.findings.find((f) => f.rowLabel === label && (issue ? f.issueType === issue : true));

// ── OmniCare 2024 balance sheet: components exist, certified totals suppressed ────────────────
describe("OmniCare 2024 balance-sheet red flags", () => {
  const byPeriod = pm({
    "2024-12-31": {
      SL_TOTAL_ASSETS: 6_800_000,
      SL_TOTAL_EQUITY: 6_800_000,
      SL_ACCOUNTS_PAYABLE: 71_364,
      SL_LOANS_FROM_SHAREHOLDERS: 1_930_705,
      SL_OTHER_LIABILITIES: 284_993,
      SL_AR_GROSS: 500_000, // allowance absent → loader's Net AR row goes blank
      SL_DEFERRED_TAX_ASSET: 12_345, // not mapped to any spread row
    },
  });
  // What the PDF actually shows after the certification gate blanked the unverifiable totals.
  const balanceSheet: FinancialRow[] = [
    row("Net Accounts Receivable", [null]),
    row("TOTAL CURRENT ASSETS", [500_000]),
    row("TOTAL NON-CURRENT ASSETS", [6_300_000]),
    row("TOTAL ASSETS", [6_800_000]),
    row("TOTAL CURRENT LIABILITIES", [71_364]),
    row("TOTAL NON-CURRENT LIABILITIES", [null]), // suppressed
    row("TOTAL LIABILITIES", [null]), // suppressed
    row("TOTAL NET WORTH", [6_800_000]),
  ];
  const input: AuditInput = {
    periods: [{ iso: "2024-12-31", label: "2024" }],
    byPeriod,
    balanceSheet,
    incomeStatement: [],
    cashFlow: [],
    factRefs: [
      { period: "2024-12-31", factKey: "SL_LOANS_FROM_SHAREHOLDERS", factId: "f-loans", documentId: "doc-bs-2024" },
      { period: "2024-12-31", factKey: "SL_OTHER_LIABILITIES", factId: "f-other", documentId: "doc-bs-2024" },
    ],
  };
  const result = auditClassicSpread(input);

  it("flags blank Total Liabilities while liability components exist (blocker)", () => {
    const f = find(result, "TOTAL LIABILITIES", "missing_required_value");
    assert.ok(f, "expected a TOTAL LIABILITIES finding");
    assert.equal(f!.severity, "blocker");
    assert.equal(f!.expectedValue, 71_364 + 1_930_705 + 284_993); // 2,287,062
    assert.equal(f!.actualValue, null);
  });

  it("flags Total Non-Current Liabilities inconsistent with Loans from Shareholders + Other Liabilities", () => {
    const f = find(result, "TOTAL NON-CURRENT LIABILITIES", "missing_required_value");
    assert.ok(f);
    assert.equal(f!.expectedValue, 1_930_705 + 284_993); // 2,215,698
    assert.equal(f!.severity, "blocker");
    // source linkage flows through factRefs
    assert.ok(f!.documentIds.includes("doc-bs-2024"));
  });

  it("flags Net AR blank when Gross AR exists and allowance is blank/zero", () => {
    const f = find(result, "Net Accounts Receivable", "missing_required_value");
    assert.ok(f);
    assert.equal(f!.expectedValue, 500_000);
    assert.equal(f!.severity, "blocker");
  });

  it("flags an extracted source line that maps to no spread row (missing_source_mapping)", () => {
    const f = find(result, "SL_DEFERRED_TAX_ASSET", "missing_source_mapping");
    assert.ok(f);
    assert.equal(f!.severity, "warning");
    assert.equal(f!.expectedValue, 12_345);
    assert.equal(result.summary.unmappedFactKeys, 1);
  });

  it("overall status is blocker and blockedCells expose the blocked rows", () => {
    assert.equal(result.status, "blocker");
    assert.ok(result.summary.blockers >= 3);
    assert.ok(result.blockedCells.some((c) => c.rowLabel === "TOTAL LIABILITIES" && c.period === "2024"));
  });

  it("does not flag rows that foot (Total Current Liabilities, Total Assets, Net Worth)", () => {
    assert.equal(find(result, "TOTAL CURRENT LIABILITIES"), undefined);
    assert.equal(find(result, "TOTAL ASSETS"), undefined);
    assert.equal(find(result, "TOTAL NET WORTH"), undefined);
  });
});

// ── Income statement: Net Profit derivable vs not-derivable ───────────────────────────────────
describe("Net Profit completeness classification", () => {
  it("blank Net Profit with derivable inputs → missing_required_value blocker", () => {
    const input: AuditInput = {
      periods: [{ iso: "2024-12-31", label: "2024" }],
      byPeriod: pm({ "2024-12-31": { GROSS_RECEIPTS: 1_000_000, COST_OF_GOODS_SOLD: 600_000, NET_INCOME: 50_000 } }),
      balanceSheet: [],
      incomeStatement: [row("GROSS PROFIT", [400_000]), row("NET PROFIT", [null])],
      cashFlow: [],
    };
    const r = auditClassicSpread(input);
    const f = find(r, "NET PROFIT", "missing_required_value");
    assert.ok(f);
    assert.equal(f!.expectedValue, 50_000);
    assert.equal(f!.severity, "blocker");
  });

  it("blank Net Profit with NO derivable inputs → missing_source_mapping warning", () => {
    const input: AuditInput = {
      periods: [{ iso: "2022-12-31", label: "2022" }],
      byPeriod: pm({ "2022-12-31": { GROSS_RECEIPTS: 800_000 } }),
      balanceSheet: [],
      incomeStatement: [row("GROSS PROFIT", [800_000]), row("NET PROFIT", [null])],
      cashFlow: [],
    };
    const r = auditClassicSpread(input);
    const f = find(r, "NET PROFIT", "missing_source_mapping");
    assert.ok(f);
    assert.equal(f!.severity, "warning");
  });

  it("flags a Gross Profit formula mismatch", () => {
    const input: AuditInput = {
      periods: [{ iso: "2024-12-31", label: "2024" }],
      byPeriod: pm({ "2024-12-31": { GROSS_RECEIPTS: 1_000_000, COST_OF_GOODS_SOLD: 600_000 } }),
      balanceSheet: [],
      incomeStatement: [row("GROSS PROFIT", [123_456])], // should be 400,000
      cashFlow: [],
    };
    const r = auditClassicSpread(input);
    const f = find(r, "GROSS PROFIT", "formula_mismatch");
    assert.ok(f);
    assert.equal(f!.expectedValue, 400_000);
    assert.equal(f!.actualValue, 123_456);
  });
});

// ── Balance-equation + cash-flow reconciliation ───────────────────────────────────────────────
describe("footing reconciliation", () => {
  it("flags a balance sheet that does not balance (TL + NW ≠ TA)", () => {
    const input: AuditInput = {
      periods: [{ iso: "2023-12-31", label: "2023" }],
      byPeriod: pm({ "2023-12-31": { SL_TOTAL_ASSETS: 1000, SL_TOTAL_EQUITY: 600 } }),
      balanceSheet: [
        row("TOTAL ASSETS", [1000]),
        row("TOTAL LIABILITIES", [500]),
        row("TOTAL NET WORTH", [600]), // 500 + 600 = 1100 ≠ 1000
      ],
      incomeStatement: [],
      cashFlow: [],
    };
    const r = auditClassicSpread(input);
    const f = find(r, "TOTAL LIABILITIES & NET WORTH", "unreconciled_total");
    assert.ok(f);
    assert.equal(f!.severity, "blocker");
    assert.equal(f!.difference, -100);
  });

  it("flags an AR working-capital change that does not reconcile to the BS delta", () => {
    const input: AuditInput = {
      periods: [
        { iso: "2022-12-31", label: "2022" },
        { iso: "2023-12-31", label: "2023" },
      ],
      byPeriod: pm({
        "2022-12-31": { SL_AR_GROSS: 100 },
        "2023-12-31": { SL_AR_GROSS: 140 }, // AR rose 40 → cash impact should be -40
      }),
      balanceSheet: [],
      incomeStatement: [],
      cashFlow: [
        { label: "(Inc) / Dec in Accounts Receivable", indent: 1, isBold: false, values: [null, 999] }, // wrong
      ],
    };
    const r = auditClassicSpread(input);
    const f = find(r, "(Inc) / Dec in Accounts Receivable", "formula_mismatch");
    assert.ok(f);
    assert.equal(f!.expectedValue, -40);
  });
});

// ── Clean spread → clean status ───────────────────────────────────────────────────────────────
describe("a fully-footing spread audits clean", () => {
  it("returns clean with no findings", () => {
    const input: AuditInput = {
      periods: [{ iso: "2023-12-31", label: "2023" }],
      byPeriod: pm({
        "2023-12-31": { SL_CASH: 100_000, SL_TOTAL_ASSETS: 100_000, SL_TOTAL_EQUITY: 60_000, SL_ACCOUNTS_PAYABLE: 40_000 },
      }),
      balanceSheet: [
        row("TOTAL CURRENT ASSETS", [100_000]),
        row("TOTAL NON-CURRENT ASSETS", [0]),
        row("TOTAL ASSETS", [100_000]),
        row("TOTAL CURRENT LIABILITIES", [40_000]),
        row("TOTAL NON-CURRENT LIABILITIES", [0]),
        row("TOTAL LIABILITIES", [40_000]),
        row("TOTAL NET WORTH", [60_000]),
      ],
      incomeStatement: [],
      cashFlow: [],
    };
    const r = auditClassicSpread(input);
    assert.equal(r.status, "clean");
    assert.deepEqual(r.findings, []);
    assert.equal(r.summary.unmappedFactKeys, 0);
    assert.ok(r.summary.footingsChecked > 0);
  });
});
