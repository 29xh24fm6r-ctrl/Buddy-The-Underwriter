import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCreditReport } from "@/lib/integrations/creditBureau/parser";

test("parseCreditReport: plaid_check nested report shape parses tradelines", () => {
  const raw = {
    report: {
      tradelines: [
        { account_type: "credit_card", creditor_name: "Chase", current_balance: 1000, high_credit: 5000, payment_history_24mo: "111111111111111111111111", status: "open" },
      ],
      fico_score: 720,
    },
  };
  const result = parseCreditReport(raw, "plaid_check");
  assert.equal(result.tradelines.length, 1);
  assert.equal(result.tradelines[0].creditor_name, "Chase");
  assert.equal(result.summary.fico_score, 720);
});

test("parseCreditReport: flat (non-plaid_check) vendor shape parses tradelines", () => {
  const raw = {
    tradelines: [{ account_type: "auto_loan", creditor_name: "Ally", current_balance: 12000, status: "open" }],
    fico_score: 680,
  };
  const result = parseCreditReport(raw, "array");
  assert.equal(result.tradelines.length, 1);
  assert.equal(result.tradelines[0].creditor_name, "Ally");
});

test("parseCreditReport: empty/missing tradelines -> empty array, zeroed summary", () => {
  const result = parseCreditReport({}, "plaid_check");
  assert.deepEqual(result.tradelines, []);
  assert.equal(result.summary.delinquencies_count, 0);
  assert.equal(result.summary.fico_score, null);
});

test("parseCreditReport: null/undefined rawJson -> empty result, no throw", () => {
  const result = parseCreditReport(null, "plaid_check");
  assert.deepEqual(result.tradelines, []);
  assert.equal(result.summary.public_records_count, 0);
});

test("parseCreditReport: charge_off status sets is_charged_off and is_delinquent", () => {
  const raw = { tradelines: [{ creditor_name: "Capital One", status: "charge_off", current_balance: 3000 }] };
  const result = parseCreditReport(raw, "array");
  assert.equal(result.tradelines[0].is_charged_off, true);
  assert.equal(result.tradelines[0].is_delinquent, true);
  assert.equal(result.summary.delinquencies_count, 1);
});

test("parseCreditReport: collection status sets is_in_collection", () => {
  const raw = { tradelines: [{ creditor_name: "Midland Funding", status: "collection" }] };
  const result = parseCreditReport(raw, "array");
  assert.equal(result.tradelines[0].is_in_collection, true);
});

test("parseCreditReport: payment_history_24mo with late-pay code -> is_delinquent true even when status is open", () => {
  const raw = { tradelines: [{ creditor_name: "Wells Fargo", status: "open", payment_history_24mo: "111111111111111111111132" }] };
  const result = parseCreditReport(raw, "array");
  assert.equal(result.tradelines[0].is_delinquent, true);
});

test("parseCreditReport: malformed open_date is dropped to null, numeric fields coerced from strings", () => {
  const raw = {
    tradelines: [
      { creditor_name: "SunTrust", open_date: "not-a-date", current_balance: "4500.50", high_credit: "10000" },
    ],
    public_records: [{ type: "lien" }],
    inquiries_24mo: [{}, {}, {}],
  };
  const result = parseCreditReport(raw, "array");
  assert.equal(result.tradelines[0].open_date, null);
  assert.equal(result.tradelines[0].current_balance, 4500.5);
  assert.equal(result.tradelines[0].high_credit, 10000);
  assert.equal(result.summary.public_records_count, 1);
  assert.equal(result.summary.inquiries_24mo_count, 3);
});
