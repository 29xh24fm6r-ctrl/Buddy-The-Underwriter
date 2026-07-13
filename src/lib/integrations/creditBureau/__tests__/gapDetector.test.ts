import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAbnormalities } from "@/lib/integrations/creditBureau/gapDetector";
import { parseCreditReport } from "@/lib/integrations/creditBureau/parser";

function tradeline(overrides: Record<string, unknown>) {
  return parseCreditReport({ tradelines: [{ creditor_name: "Test Creditor", ...overrides }] }, "array").tradelines[0];
}

test("detectAbnormalities: clean tradeline -> no abnormalities", () => {
  const t = tradeline({ status: "open", payment_history_24mo: "111111111111111111111111" });
  const result = detectAbnormalities([t]);
  assert.equal(result.length, 0);
});

test("detectAbnormalities: charge_off -> HIGH severity charge_off abnormality", () => {
  const t = tradeline({ status: "charge_off", current_balance: 5000 });
  const result = detectAbnormalities([t]);
  assert.equal(result.length, 1);
  assert.equal(result[0].abnormality_type, "charge_off");
  assert.equal(result[0].severity, "HIGH");
  assert.ok(result[0].suggested_explanation_prompt.includes("charged-off"));
});

test("detectAbnormalities: collection -> HIGH severity collection abnormality", () => {
  const t = tradeline({ status: "collection" });
  const result = detectAbnormalities([t]);
  assert.equal(result.length, 1);
  assert.equal(result[0].abnormality_type, "collection");
  assert.equal(result[0].severity, "HIGH");
});

test("detectAbnormalities: 60-day-or-worse late in last 12mo -> recent_delinquency HIGH", () => {
  const t = tradeline({ status: "open", payment_history_24mo: "311111111111111111111111" });
  const result = detectAbnormalities([t]);
  assert.equal(result.length, 1);
  assert.equal(result[0].abnormality_type, "recent_delinquency");
  assert.equal(result[0].severity, "HIGH");
});

test("detectAbnormalities: 30-day late in last 12mo (no worse) -> mild_delinquency MEDIUM", () => {
  const t = tradeline({ status: "open", payment_history_24mo: "211111111111111111111111" });
  const result = detectAbnormalities([t]);
  assert.equal(result.length, 1);
  assert.equal(result[0].abnormality_type, "mild_delinquency");
  assert.equal(result[0].severity, "MEDIUM");
});

test("detectAbnormalities: credit card utilization > 85% -> high_utilization MEDIUM", () => {
  const t = tradeline({ account_type: "credit_card", current_balance: 9000, high_credit: 10000, status: "open" });
  const result = detectAbnormalities([t]);
  assert.equal(result.length, 1);
  assert.equal(result[0].abnormality_type, "high_utilization");
});

test("detectAbnormalities: large non-mortgage balance > $100K -> large_unsecured_debt INFO", () => {
  const t = tradeline({ account_type: "other", current_balance: 150_000, status: "open" });
  const result = detectAbnormalities([t]);
  assert.equal(result.length, 1);
  assert.equal(result[0].abnormality_type, "large_unsecured_debt");
  assert.equal(result[0].severity, "INFO");
});

test("detectAbnormalities: > 6 inquiries in 24mo -> excessive_inquiries LOW, report-level (tradeline_index -1)", () => {
  const t = tradeline({ status: "open" });
  const result = detectAbnormalities([t], 8);
  assert.equal(result.length, 1);
  assert.equal(result[0].abnormality_type, "excessive_inquiries");
  assert.equal(result[0].severity, "LOW");
  assert.equal(result[0].tradeline_index, -1);
});

test("detectAbnormalities: large mortgage balance is NOT flagged as large_unsecured_debt", () => {
  const t = tradeline({ account_type: "mortgage", current_balance: 400_000, status: "open" });
  const result = detectAbnormalities([t]);
  assert.equal(result.length, 0);
});
