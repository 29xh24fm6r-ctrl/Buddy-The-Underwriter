import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveBalanceSheet,
  resolveIncomeStatement1120,
  type Facts,
} from "../statementTruthResolver";

const find = <T extends { rowLabel: string; issueType: string }>(fs: T[], label: string, issue?: string): T | undefined =>
  fs.find((f) => f.rowLabel === label && (issue ? f.issueType === issue : true));

// ── 2024: direct equity wrong → rejected in favor of retained earnings / M-2 ──────────────────
describe("2024 OmniCare balance sheet resolver", () => {
  const facts: Facts = {
    SL_TOTAL_ASSETS: 6_800_000,
    SL_ACCOUNTS_PAYABLE: 71_364,
    SL_LOANS_FROM_SHAREHOLDERS: 1_930_705,
    SL_OTHER_LIABILITIES: 284_993,
    SL_RETAINED_EARNINGS: 4_512_938, // M-2 ending balance
    SL_TOTAL_EQUITY: 6_800_000, // wrong direct value (equals assets)
  };
  const r = resolveBalanceSheet(facts);

  it("resolves Total Liabilities to the component sum 2,287,062", () => {
    assert.equal(r.totalLiabilities.value, 2_287_062);
    assert.equal(r.totalLiabilities.basis, "component_sum");
  });

  it("rejects direct SL_TOTAL_EQUITY and resolves equity to retained earnings 4,512,938", () => {
    assert.equal(r.totalEquity.value, 4_512_938);
    assert.equal(r.totalEquity.basis, "retained_earnings");
    const f = find(r.findings, "TOTAL NET WORTH", "rejected_source_value");
    assert.ok(f, "direct equity must be flagged rejected/suspect");
    assert.equal(f!.severity, "blocker");
    assert.equal(f!.rejectedSource!.key, "SL_TOTAL_EQUITY");
    assert.equal(f!.rejectedSource!.value, 6_800_000);
  });

  it("balance sheet now mathematically balances: L + E = 6,800,000 = Assets", () => {
    assert.equal(r.totalLiabilitiesAndEquity.value, 6_800_000);
    assert.equal(r.totalAssets.value, 6_800_000);
    // no balance-equation blocker once equity is resolved
    assert.equal(find(r.findings, "TOTAL LIABILITIES & NET WORTH", "unreconciled_total"), undefined);
  });

  it("still BLOCKER overall (the rejected source value requires confirmation)", () => {
    assert.ok(r.findings.some((f) => f.severity === "blocker"));
  });
});

// ── 2025: direct TCA equals AR only and excludes cash ─────────────────────────────────────────
describe("2025 OmniCare balance sheet resolver", () => {
  const facts: Facts = {
    SL_CASH: 739_144,
    SL_AR_GROSS: 2_393_922,
    SL_TOTAL_CURRENT_ASSETS: 2_393_922, // direct TCA == AR only (excludes cash)
    SL_TOTAL_ASSETS: 3_342_586,
    SL_NET_FIXED_ASSETS: 209_520,
  };
  const r = resolveBalanceSheet(facts);

  it("rejects the direct TCA and resolves Total Current Assets to 3,133,066", () => {
    assert.equal(r.totalCurrentAssets.value, 3_133_066);
    const f = find(r.findings, "TOTAL CURRENT ASSETS", "rejected_source_value");
    assert.ok(f);
    assert.match(f!.detail, /excludes Cash/);
    assert.equal(f!.severity, "blocker");
  });

  it("resolves Total Non-Current Assets to 209,520 (not inflated by the bad TCA)", () => {
    assert.equal(r.totalNonCurrentAssets.value, 209_520);
  });
});

// ── YTD 2026: direct TCA implies a missing AR / current asset ──────────────────────────────────
describe("YTD 2026 OmniCare balance sheet resolver", () => {
  const facts: Facts = {
    SL_CASH: 198_693,
    SL_TOTAL_CURRENT_ASSETS: 3_097_345, // direct TCA > known components (AR blank)
    SL_TOTAL_ASSETS: 3_501_691,
    SL_NET_FIXED_ASSETS: 205_654,
  };
  const r = resolveBalanceSheet(facts);

  it("keeps the direct TCA and emits missing_implied_component for the ~2,898,652 gap", () => {
    assert.equal(r.totalCurrentAssets.value, 3_097_345);
    assert.equal(r.totalCurrentAssets.basis, "direct");
    const f = find(r.findings, "TOTAL CURRENT ASSETS", "missing_implied_component");
    assert.ok(f);
    assert.equal(f!.difference, 2_898_652); // 3,097,345 − 198,693
  });

  it("does not render clean (a blocker remains)", () => {
    assert.ok(r.findings.some((f) => f.severity === "blocker"));
  });
});

// ── Income statement (1120) resolver ───────────────────────────────────────────────────────────
describe("income statement 1120 resolver", () => {
  // SPEC-CLASSIC-SPREAD-SOURCE-LINE-MODEL-PARITY-1 #3 — a Gross Profit gap explained by an implied,
  // positive, material returns/allowances is INFERRED (no longer a hard GP blocker) but kept as a
  // VERIFY_SOURCE_LINE warning until line 1b is sourced.
  it("infers returns/allowances for a GP gap and keeps it a VERIFY_SOURCE_LINE warning (no GP blocker)", () => {
    const r = resolveIncomeStatement1120({ GROSS_RECEIPTS: 1_000_000, COST_OF_GOODS_SOLD: 600_000, GROSS_PROFIT: 350_000 });
    assert.equal(r.returnsInferred, true);
    assert.equal(r.returnsAllowances.value, 50_000); // 1,000,000 − 600,000 − 350,000
    assert.equal(r.netSales.value, 950_000);
    assert.equal(r.grossProfit.value, 350_000);
    // GP itself is no longer a blocker — it reconciles against inferred net sales.
    assert.equal(find(r.findings, "GROSS PROFIT", "formula_mismatch"), undefined);
    // but the inferred return is surfaced as a warning on Sales / Revenues.
    const v = find(r.findings, "Sales / Revenues", "formula_mismatch");
    assert.ok(v);
    assert.equal(v!.severity, "warning");
  });

  it("a NEGATIVE/immaterial implied return is NOT inferred — GP stays a blocker", () => {
    // GP (700,000) exceeds gross − COGS (400,000): implied returns would be negative → no inference.
    const r = resolveIncomeStatement1120({ GROSS_RECEIPTS: 1_000_000, COST_OF_GOODS_SOLD: 600_000, GROSS_PROFIT: 700_000 });
    assert.equal(r.returnsInferred, false);
    const f = find(r.findings, "GROSS PROFIT", "formula_mismatch");
    assert.ok(f);
    assert.equal(f!.severity, "blocker");
  });

  it("the Gross Profit conflict is resolved when a returns/allowances line explains it", () => {
    const r = resolveIncomeStatement1120({ GROSS_RECEIPTS: 1_000_000, RETURNS_ALLOWANCES: 50_000, COST_OF_GOODS_SOLD: 600_000, GROSS_PROFIT: 350_000 });
    assert.equal(find(r.findings, "GROSS PROFIT", "formula_mismatch"), undefined);
    assert.equal(r.grossProfit.value, 350_000);
  });

  it("derives Gross Profit = Revenue − COGS when the direct line is missing", () => {
    const r = resolveIncomeStatement1120({ GROSS_RECEIPTS: 1_000_000, COST_OF_GOODS_SOLD: 600_000 });
    assert.equal(r.grossProfit.value, 400_000);
    assert.equal(r.grossProfit.basis, "derived");
  });

  it("TOTAL_INCOME cannot satisfy GROSS_PROFIT", () => {
    const r = resolveIncomeStatement1120({ TOTAL_INCOME: 282_742 });
    assert.notEqual(r.grossProfit.value, 282_742);
    assert.equal(r.grossProfit.value, null);
    assert.ok(find(r.findings, "GROSS PROFIT", "formula_mismatch"));
  });
});
