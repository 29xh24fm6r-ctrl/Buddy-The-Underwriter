import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTransaction } from "@/lib/integrations/plaid/classifier";
import type { PlaidTransactionLike } from "@/lib/integrations/plaid/types";

function tx(overrides: Partial<PlaidTransactionLike>): PlaidTransactionLike {
  return {
    transaction_id: "t1",
    name: null,
    merchant_name: null,
    amount: 100,
    date: "2026-01-15",
    ...overrides,
  };
}

/** Builds a 3-occurrence monthly history for the same merchant, ending on `lastDate`. */
function monthlyHistory(merchant: string, lastDate: string, amount = 100): PlaidTransactionLike[] {
  const last = new Date(lastDate);
  const dates = [0, 30, 60].map((daysAgo) => {
    const d = new Date(last);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  });
  return dates.map((date, i) => tx({ transaction_id: `h${i}`, name: merchant, date, amount }));
}

test("GUSTO PAYROLL -> payroll", () => {
  const r = classifyTransaction(tx({ name: "GUSTO PAYROLL" }));
  assert.equal(r.derived_category, "payroll");
});

test("ADP PAYROLL FEES -> payroll", () => {
  const r = classifyTransaction(tx({ name: "ADP PAYROLL FEES" }));
  assert.equal(r.derived_category, "payroll");
});

test("Capital One Mortgage Pmt (recurring monthly) -> recurring_payment monthly", () => {
  const history = monthlyHistory("Capital One Mortgage Pmt", "2026-03-15");
  const target = history[0];
  const r = classifyTransaction(target, history.slice(1));
  assert.equal(r.derived_category, "recurring_payment");
  assert.equal(r.derived_recurrence, "monthly");
});

test("ClearToCash MCA Funding -> mca", () => {
  const r = classifyTransaction(tx({ name: "ClearToCash MCA Funding" }));
  assert.equal(r.derived_category, "mca");
});

test("Kapitus Daily Remittance -> mca", () => {
  const r = classifyTransaction(tx({ name: "Kapitus Daily Remittance" }));
  assert.equal(r.derived_category, "mca");
});

test("Zelle to John Doe -> transfer", () => {
  const r = classifyTransaction(tx({ name: "Zelle to John Doe" }));
  assert.equal(r.derived_category, "transfer");
  assert.equal(r.derived_recurrence, "irregular");
});

test("Venmo Payment -> transfer", () => {
  const r = classifyTransaction(tx({ name: "Venmo Payment" }));
  assert.equal(r.derived_category, "transfer");
});

test("Office Rent - 123 Main St LLC (recurring monthly) -> rent monthly", () => {
  const history = monthlyHistory("Office Rent - 123 Main St LLC", "2026-03-15");
  const target = history[0];
  const r = classifyTransaction(target, history.slice(1));
  assert.equal(r.derived_category, "rent");
  assert.equal(r.derived_recurrence, "monthly");
});

test("SBA 7(a) Loan Payment -> sba_loan_payment", () => {
  const r = classifyTransaction(tx({ name: "SBA 7(a) Loan Payment" }));
  assert.equal(r.derived_category, "sba_loan_payment");
  assert.equal(r.derived_recurrence, "monthly");
});

test("STARBUCKS #4521 -> null (not classified)", () => {
  const r = classifyTransaction(tx({ name: "STARBUCKS #4521" }));
  assert.equal(r.derived_category, null);
  assert.equal(r.derived_recurrence, null);
});

test("Comcast Internet (recurring monthly) -> recurring_payment monthly", () => {
  const history = monthlyHistory("Comcast Internet", "2026-03-15");
  const target = history[0];
  const r = classifyTransaction(target, history.slice(1));
  assert.equal(r.derived_category, "recurring_payment");
  assert.equal(r.derived_recurrence, "monthly");
});

test("Verizon Wireless (recurring monthly) -> recurring_payment monthly", () => {
  const history = monthlyHistory("Verizon Wireless", "2026-03-15");
  const target = history[0];
  const r = classifyTransaction(target, history.slice(1));
  assert.equal(r.derived_category, "recurring_payment");
  assert.equal(r.derived_recurrence, "monthly");
});

test("One-off Best Buy purchase -> null", () => {
  const r = classifyTransaction(tx({ name: "Best Buy #112" }));
  assert.equal(r.derived_category, null);
});

test("Aetna Insurance Premium (recurring monthly) -> recurring_payment monthly", () => {
  const history = monthlyHistory("Aetna Insurance Premium", "2026-03-15");
  const target = history[0];
  const r = classifyTransaction(target, history.slice(1));
  assert.equal(r.derived_category, "recurring_payment");
  assert.equal(r.derived_recurrence, "monthly");
});

test("Forwardline Capital Daily -> mca", () => {
  const r = classifyTransaction(tx({ name: "Forwardline Capital Daily" }));
  assert.equal(r.derived_category, "mca");
});

test("OnDeck Capital Repayment -> mca", () => {
  const r = classifyTransaction(tx({ name: "OnDeck Capital Repayment" }));
  assert.equal(r.derived_category, "mca");
});

test("Libertas Funding Daily Debit -> mca", () => {
  const r = classifyTransaction(tx({ name: "Libertas Funding Daily Debit" }));
  assert.equal(r.derived_category, "mca");
});

test("Cash App Payment -> transfer", () => {
  const r = classifyTransaction(tx({ name: "Cash App Payment" }));
  assert.equal(r.derived_category, "transfer");
});

test("credit (negative amount) is not classified as recurring_payment even with monthly cadence", () => {
  const history = monthlyHistory("Refund Co", "2026-03-15", -50);
  const target = history[0];
  const r = classifyTransaction(target, history.slice(1));
  assert.equal(r.derived_category, null);
});

test("only 2 occurrences of same merchant does not trigger recurring_payment", () => {
  const target = tx({ transaction_id: "a", name: "Random Vendor", date: "2026-03-15" });
  const sibling = tx({ transaction_id: "b", name: "Random Vendor", date: "2026-02-13" });
  const r = classifyTransaction(target, [sibling]);
  assert.equal(r.derived_category, null);
});
