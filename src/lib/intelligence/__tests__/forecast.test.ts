import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const { FakeDb } = require("./testFakeDb") as typeof import("./testFakeDb");
const forecast = require("../forecast") as typeof import("../forecast");

const BANK_A = "bank-a";

test("pipeline forecast: best case is full loan volume, expected case is probability-weighted, assumptions are visible", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", bank_id: BANK_A, loan_amount: 1000000, brokerage_stage: "commitment", referral_source_org_id: null, created_at: "2026-01-01T00:00:00Z" }],
    brokerage_leads: [{ id: "l1", bank_id: BANK_A, loan_amount_requested: 500000, status: "qualified", referral_source_org_id: null, owner_clerk_user_id: null, expected_conversion_date: null, loan_program: null, conversion_probability_pct: null, created_at: "2026-01-01T00:00:00Z" }],
  });

  const result = await forecast.computePipelineForecast(BANK_A, db as any);

  assert.equal(result.bestCaseLoanVolumeCents, 150000000, "1,000,000 deal + 500,000 lead, in cents");
  // deal at 'commitment' = 0.9 weight; lead at 'qualified' default = 0.35 weight
  const expected = Math.round(100000000 * 0.9) + Math.round(50000000 * 0.35);
  assert.equal(result.expectedLoanVolumeCents, expected);
  assert.ok(result.assumptions.dealStageWeights.commitment === 0.9, "assumptions must expose the exact weight used");
  assert.ok(result.assumptions.feeRateBpsUsed > 0);
});

test("pipeline forecast: a lead's own conversion_probability_pct overrides the status-based default", async () => {
  const db = new FakeDb({
    brokerage_leads: [{ id: "l1", bank_id: BANK_A, loan_amount_requested: 1000000, status: "new", referral_source_org_id: null, owner_clerk_user_id: null, expected_conversion_date: null, loan_program: null, conversion_probability_pct: 90, created_at: "2026-01-01T00:00:00Z" }],
  });
  const result = await forecast.computePipelineForecast(BANK_A, db as any);
  assert.equal(result.expectedLoanVolumeCents, Math.round(100000000 * 0.9));
});

test("pipeline forecast: terminal-stage deals and terminal-status leads are excluded from the pipeline", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", bank_id: BANK_A, loan_amount: 1000000, brokerage_stage: "lost", referral_source_org_id: null, created_at: "2026-01-01T00:00:00Z" }],
    brokerage_leads: [{ id: "l1", bank_id: BANK_A, loan_amount_requested: 1000000, status: "disqualified", referral_source_org_id: null, owner_clerk_user_id: null, expected_conversion_date: null, loan_program: null, conversion_probability_pct: null, created_at: "2026-01-01T00:00:00Z" }],
  });
  const result = await forecast.computePipelineForecast(BANK_A, db as any);
  assert.equal(result.bestCaseLoanVolumeCents, 0);
});

test("tenant isolation: forecast never includes another bank's pipeline", async () => {
  const db = new FakeDb({
    deals: [
      { id: "d1", bank_id: BANK_A, loan_amount: 1000, brokerage_stage: "intake", referral_source_org_id: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "d2", bank_id: "bank-b", loan_amount: 99999999, brokerage_stage: "intake", referral_source_org_id: null, created_at: "2026-01-01T00:00:00Z" },
    ],
  });
  const result = await forecast.computePipelineForecast(BANK_A, db as any);
  assert.equal(result.bestCaseLoanVolumeCents, 100000);
});
