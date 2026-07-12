import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDebtSchedule } from "@/lib/financialFacts/debtScheduleAutoBuilder";

function monthsAgo(n: number): string {
  const d = new Date("2026-07-12T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

test("buildDebtSchedule: single mortgage transaction -> one entry inferred as mortgage", () => {
  const result = buildDebtSchedule([
    { posted_date: monthsAgo(1), amount: 2500, merchant_name: "Wells Fargo Mortgage", derived_category: "recurring_payment" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].account_type_inferred, "mortgage");
  assert.equal(result[0].monthly_payment, 2500);
});

test("buildDebtSchedule: multiple credit card payments, same merchant -> one entry, credit_card inferred", () => {
  const result = buildDebtSchedule([
    { posted_date: monthsAgo(1), amount: 300, merchant_name: "Chase Card Services", derived_category: "recurring_payment" },
    { posted_date: monthsAgo(2), amount: 300, merchant_name: "Chase Card Services", derived_category: "recurring_payment" },
    { posted_date: monthsAgo(3), amount: 300, merchant_name: "Chase Card Services", derived_category: "recurring_payment" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].account_type_inferred, "credit_card");
  assert.equal(result[0].monthly_payment, 300);
});

test("buildDebtSchedule: MCA daily remittances -> one entry, mca inferred", () => {
  const result = buildDebtSchedule([
    { posted_date: monthsAgo(0), amount: 150, merchant_name: "OnDeck Capital", derived_category: "mca" },
    { posted_date: monthsAgo(1), amount: 150, merchant_name: "OnDeck Capital", derived_category: "mca" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].account_type_inferred, "mca");
});

test("buildDebtSchedule: mixed transactions across creditors -> all categorized into separate entries", () => {
  const result = buildDebtSchedule([
    { posted_date: monthsAgo(1), amount: 2500, merchant_name: "Wells Fargo Mortgage", derived_category: "recurring_payment" },
    { posted_date: monthsAgo(1), amount: 300, merchant_name: "Chase Card Services", derived_category: "recurring_payment" },
    { posted_date: monthsAgo(1), amount: 150, merchant_name: "OnDeck Capital", derived_category: "mca" },
    { posted_date: monthsAgo(1), amount: 1200, merchant_name: "SBA 7a Loan Payment", derived_category: "sba_loan_payment" },
  ]);
  assert.equal(result.length, 4);
  const types = result.map((r) => r.account_type_inferred).sort();
  assert.deepEqual(types, ["credit_card", "mca", "mortgage", "sba_loan"]);
});

test("buildDebtSchedule: insufficient history (single month) -> confidence < 0.5", () => {
  const result = buildDebtSchedule([
    { posted_date: monthsAgo(0), amount: 300, merchant_name: "New Vendor Financing", derived_category: "recurring_payment" },
  ]);
  assert.equal(result.length, 1);
  assert.ok(result[0].confidence < 0.5);
});

test("buildDebtSchedule: empty transactions -> empty array", () => {
  const result = buildDebtSchedule([]);
  assert.deepEqual(result, []);
});
