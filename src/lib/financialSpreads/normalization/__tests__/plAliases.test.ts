import test from "node:test";
import assert from "node:assert/strict";

import { normalizePlLabel, PL_ALIASES } from "../plAliases";

// ── Revenue variants ────────────────────────────────────────────────────────

test("normalizePlLabel: 'Revenue' → GROSS_REVENUE", () => {
  const r = normalizePlLabel("Revenue");
  assert.equal(r?.key, "GROSS_REVENUE");
  assert.equal(r?.factKey, "TOTAL_REVENUE");
});

test("normalizePlLabel: 'Total Sales Revenue' → GROSS_REVENUE", () => {
  assert.equal(normalizePlLabel("Total Sales Revenue")?.key, "GROSS_REVENUE");
});

test("normalizePlLabel: 'Gross Receipts' → GROSS_REVENUE", () => {
  assert.equal(normalizePlLabel("Gross Receipts")?.key, "GROSS_REVENUE");
});

test("normalizePlLabel: 'Sales Revenue from Charters' → GROSS_REVENUE (via /charter/)", () => {
  const r = normalizePlLabel("Sales Revenue from Charters");
  assert.equal(r?.key, "GROSS_REVENUE");
});

test("normalizePlLabel: 'Net Sales' → GROSS_REVENUE", () => {
  assert.equal(normalizePlLabel("Net Sales")?.key, "GROSS_REVENUE");
});

test("normalizePlLabel: 'Service Revenue' → GROSS_REVENUE", () => {
  assert.equal(normalizePlLabel("Service Revenue")?.key, "GROSS_REVENUE");
});

test("normalizePlLabel: 'Contract Revenue' → GROSS_REVENUE", () => {
  assert.equal(normalizePlLabel("Contract Revenue")?.key, "GROSS_REVENUE");
});

test("normalizePlLabel: 'Fee Income' → GROSS_REVENUE", () => {
  assert.equal(normalizePlLabel("Fee Income")?.key, "GROSS_REVENUE");
});

test("normalizePlLabel: 'Operating Revenue' → GROSS_REVENUE", () => {
  assert.equal(normalizePlLabel("Operating Revenue")?.key, "GROSS_REVENUE");
});

// ── COGS variants ───────────────────────────────────────────────────────────

test("normalizePlLabel: 'Cost of Goods Sold' → COGS", () => {
  const r = normalizePlLabel("Cost of Goods Sold");
  assert.equal(r?.key, "COGS");
  assert.equal(r?.factKey, "COST_OF_GOODS_SOLD");
});

test("normalizePlLabel: 'Cost of Sales' → COGS", () => {
  assert.equal(normalizePlLabel("Cost of Sales")?.key, "COGS");
});

test("normalizePlLabel: 'Direct Costs' → COGS", () => {
  assert.equal(normalizePlLabel("Direct Costs")?.key, "COGS");
});

test("normalizePlLabel: 'COGS' → COGS", () => {
  assert.equal(normalizePlLabel("COGS")?.key, "COGS");
});

test("normalizePlLabel: 'Merchant Fees' → COGS", () => {
  assert.equal(normalizePlLabel("Merchant Fees")?.key, "COGS");
});

test("normalizePlLabel: 'Materials Cost' → COGS", () => {
  assert.equal(normalizePlLabel("Materials Cost")?.key, "COGS");
});

// ── Gross Profit ────────────────────────────────────────────────────────────

test("normalizePlLabel: 'Gross Profit' → GROSS_PROFIT", () => {
  assert.equal(normalizePlLabel("Gross Profit")?.key, "GROSS_PROFIT");
  assert.equal(normalizePlLabel("Gross Profit")?.factKey, "GROSS_PROFIT");
});

test("normalizePlLabel: 'Gross Margin' → GROSS_PROFIT", () => {
  assert.equal(normalizePlLabel("Gross Margin")?.key, "GROSS_PROFIT");
});

// ── Operating Expenses ──────────────────────────────────────────────────────

test("normalizePlLabel: 'Total Operating Expenses' → OPERATING_EXPENSES", () => {
  assert.equal(normalizePlLabel("Total Operating Expenses")?.key, "OPERATING_EXPENSES");
  assert.equal(normalizePlLabel("Total Operating Expenses")?.factKey, "TOTAL_OPERATING_EXPENSES");
});

test("normalizePlLabel: 'Total Expenses' → OPERATING_EXPENSES", () => {
  assert.equal(normalizePlLabel("Total Expenses")?.key, "OPERATING_EXPENSES");
});

// ── Opex buckets ────────────────────────────────────────────────────────────

test("normalizePlLabel: 'Payroll' → PAYROLL", () => {
  assert.equal(normalizePlLabel("Payroll")?.key, "PAYROLL");
  assert.equal(normalizePlLabel("Payroll")?.factKey, "PAYROLL");
});

test("normalizePlLabel: 'Salaries' → PAYROLL", () => {
  assert.equal(normalizePlLabel("Salaries")?.key, "PAYROLL");
});

test("normalizePlLabel: 'Wages' → PAYROLL", () => {
  assert.equal(normalizePlLabel("Wages")?.key, "PAYROLL");
});

test("normalizePlLabel: 'Rent' → RENT", () => {
  const r = normalizePlLabel("Rent");
  assert.equal(r?.key, "RENT");
  assert.equal(r?.factKey, "OTHER_OPEX");
});

test("normalizePlLabel: 'Rent Roll' does NOT match RENT (negative lookahead)", () => {
  assert.equal(normalizePlLabel("Rent Roll"), null);
});

test("normalizePlLabel: 'Lease Expense' → RENT", () => {
  assert.equal(normalizePlLabel("Lease Expense")?.key, "RENT");
});

test("normalizePlLabel: 'Insurance' → INSURANCE", () => {
  assert.equal(normalizePlLabel("Insurance")?.key, "INSURANCE");
  assert.equal(normalizePlLabel("Insurance")?.factKey, "INSURANCE");
});

test("normalizePlLabel: 'Insurance Income' does NOT match (negative lookahead)", () => {
  assert.equal(normalizePlLabel("Insurance Income"), null);
});

test("normalizePlLabel: 'Repairs & Maintenance' → REPAIRS_MAINTENANCE", () => {
  assert.equal(normalizePlLabel("Repairs & Maintenance")?.key, "REPAIRS_MAINTENANCE");
});

test("normalizePlLabel: 'R&M' → REPAIRS_MAINTENANCE", () => {
  assert.equal(normalizePlLabel("R&M")?.key, "REPAIRS_MAINTENANCE");
});

test("normalizePlLabel: 'Marina Svcs' → REPAIRS_MAINTENANCE", () => {
  assert.equal(normalizePlLabel("Marina Svcs")?.key, "REPAIRS_MAINTENANCE");
});

// ── Below-the-line ──────────────────────────────────────────────────────────

test("normalizePlLabel: 'Interest Expense' → INTEREST_EXPENSE", () => {
  assert.equal(normalizePlLabel("Interest Expense")?.key, "INTEREST_EXPENSE");
  assert.equal(normalizePlLabel("Interest Expense")?.factKey, "DEBT_SERVICE");
});

test("normalizePlLabel: 'Debt Service' → INTEREST_EXPENSE", () => {
  assert.equal(normalizePlLabel("Debt Service")?.key, "INTEREST_EXPENSE");
});

test("normalizePlLabel: 'Depreciation' → DEPRECIATION_AMORTIZATION", () => {
  assert.equal(normalizePlLabel("Depreciation")?.key, "DEPRECIATION_AMORTIZATION");
  assert.equal(normalizePlLabel("Depreciation")?.factKey, "DEPRECIATION");
});

test("normalizePlLabel: 'Amortization' → DEPRECIATION_AMORTIZATION", () => {
  assert.equal(normalizePlLabel("Amortization")?.key, "DEPRECIATION_AMORTIZATION");
});

// ── Pre-tax / Net Income ────────────────────────────────────────────────────

test("normalizePlLabel: 'Income Before Tax' → PRETAX_INCOME", () => {
  assert.equal(normalizePlLabel("Income Before Tax")?.key, "PRETAX_INCOME");
  assert.equal(normalizePlLabel("Income Before Tax")?.factKey, "OPERATING_INCOME");
});

test("normalizePlLabel: 'Operating Income' → PRETAX_INCOME", () => {
  assert.equal(normalizePlLabel("Operating Income")?.key, "PRETAX_INCOME");
});

test("normalizePlLabel: 'Pre-Tax Income' → PRETAX_INCOME", () => {
  assert.equal(normalizePlLabel("Pre-Tax Income")?.key, "PRETAX_INCOME");
});

test("normalizePlLabel: 'EBT' → PRETAX_INCOME", () => {
  assert.equal(normalizePlLabel("EBT")?.key, "PRETAX_INCOME");
});

test("normalizePlLabel: 'Net Income' → NET_INCOME", () => {
  const r = normalizePlLabel("Net Income");
  assert.equal(r?.key, "NET_INCOME");
  assert.equal(r?.factKey, "NET_INCOME");
});

test("normalizePlLabel: 'Net Profit' → NET_INCOME", () => {
  assert.equal(normalizePlLabel("Net Profit")?.key, "NET_INCOME");
});

test("normalizePlLabel: 'Net Loss' → NET_INCOME", () => {
  assert.equal(normalizePlLabel("Net Loss")?.key, "NET_INCOME");
});

test("normalizePlLabel: 'Bottom Line' → NET_INCOME", () => {
  assert.equal(normalizePlLabel("Bottom Line")?.key, "NET_INCOME");
});

// ── Non-matches ─────────────────────────────────────────────────────────────

test("normalizePlLabel: empty string → null", () => {
  assert.equal(normalizePlLabel(""), null);
});

test("normalizePlLabel: random text → null", () => {
  assert.equal(normalizePlLabel("General Ledger Reference"), null);
});

test("normalizePlLabel: whitespace only → null", () => {
  assert.equal(normalizePlLabel("   "), null);
});

// ── factKey coverage ────────────────────────────────────────────────────────

test("every alias entry has a non-empty factKey", () => {
  for (const entry of PL_ALIASES) {
    assert.ok(entry.factKey, `${entry.key} must have a factKey`);
  }
});

test("every alias entry has at least one pattern", () => {
  for (const entry of PL_ALIASES) {
    assert.ok(entry.patterns.length > 0, `${entry.key} must have patterns`);
  }
});
