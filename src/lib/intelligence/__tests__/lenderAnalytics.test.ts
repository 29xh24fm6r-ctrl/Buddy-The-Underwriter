import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const { FakeDb } = require("./testFakeDb") as typeof import("./testFakeDb");
const lenderAnalytics = require("../lenderAnalytics") as typeof import("../lenderAnalytics");

const BANK_A = "bank-a";
const LENDER_1 = "lender-bank-1";

test("lender performance: term sheet / approval / funding rates and response time compute from stage transitions", async () => {
  const db = new FakeDb({
    banks: [{ id: LENDER_1, name: "First Community Bank" }],
    brokerage_closing_workflows: [{ id: "wf1", deal_id: "d1", lender_bank_id: LENDER_1, status: "funded", opened_at: "2026-02-01T00:00:00Z", funded_at: "2026-03-01T00:00:00Z" }],
    deals: [{ id: "d1", bank_id: BANK_A, brokerage_stage: "funded" }],
    deal_brokerage_stage_transitions: [
      { deal_id: "d1", bank_id: BANK_A, from_stage: "lender_strategy", to_stage: "submitted", reason: null, created_at: "2026-01-01T00:00:00Z" },
      { deal_id: "d1", bank_id: BANK_A, from_stage: "submitted", to_stage: "term_sheet", reason: null, created_at: "2026-01-08T00:00:00Z" },
      { deal_id: "d1", bank_id: BANK_A, from_stage: "underwriting", to_stage: "commitment", reason: null, created_at: "2026-02-01T00:00:00Z" },
      { deal_id: "d1", bank_id: BANK_A, from_stage: "closing", to_stage: "funded", reason: null, created_at: "2026-03-01T00:00:00Z" },
    ],
    lender_marketplace_agreements: [{ id: "agr1", lender_bank_id: LENDER_1, referral_fee_bps: 150, accepts_sba_7a: true, status: "active", created_at: "2026-01-01T00:00:00Z" }],
  });

  const perf = await lenderAnalytics.computeLenderPerformance(BANK_A, LENDER_1, db as any);

  assert.equal(perf.lenderName, "First Community Bank");
  assert.equal(perf.termSheetRate, 1);
  assert.equal(perf.approvalRate, 1);
  assert.equal(perf.fundingRate, 1);
  assert.equal(perf.avgResponseTimeDays, 7);
  assert.equal(perf.avgCloseTimeDays, 28);
  assert.equal(perf.appetite?.referralFeeBps, 150);
});

test("lender performance: does not fabricate appetite fields when no lender_programs match exists", async () => {
  const db = new FakeDb({ banks: [{ id: LENDER_1, name: "Unmatched Bank" }] });
  const perf = await lenderAnalytics.computeLenderPerformance(BANK_A, LENDER_1, db as any);
  assert.equal(perf.appetite, null, "must not invent appetite data with no agreement or program on file");
});

test("lender performance: decline reasons are collected verbatim from transition reasons", async () => {
  const db = new FakeDb({
    banks: [{ id: LENDER_1, name: "Picky Bank" }],
    brokerage_closing_workflows: [{ id: "wf1", deal_id: "d1", lender_bank_id: LENDER_1, status: "cancelled" }],
    deals: [{ id: "d1", bank_id: BANK_A, brokerage_stage: "declined" }],
    deal_brokerage_stage_transitions: [
      { deal_id: "d1", bank_id: BANK_A, from_stage: "lender_strategy", to_stage: "submitted", reason: null, created_at: "2026-01-01T00:00:00Z" },
      { deal_id: "d1", bank_id: BANK_A, from_stage: "underwriting", to_stage: "declined", reason: "insufficient collateral", created_at: "2026-01-15T00:00:00Z" },
    ],
  });
  const perf = await lenderAnalytics.computeLenderPerformance(BANK_A, LENDER_1, db as any);
  assert.deepEqual(perf.declineReasons, ["insufficient collateral"]);
});
