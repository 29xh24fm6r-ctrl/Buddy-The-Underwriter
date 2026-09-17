import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { confirmedMemoFunding, reconcileMemoFunding } = require("../memoFunding") as typeof import("../memoFunding");
const { computeMemoInputHash } = require("../memoProvenance") as typeof import("../memoProvenance");
const { buildQualitativeAssessment } = require("../buildQualitativeAssessment") as typeof import("../buildQualitativeAssessment");
const row = { status: "confirmed", confirmed_at: "2026-09-17", loan_impact: { loanAmount: 850000, equityInjectionAmount: 150000, equityInjectionSource: "cash_savings", sellerFinancingAmount: 0, otherSources: [] } } as any;
const proceeds = [{ category: "equipment", description: "Equipment", amount: 750000 }, { category: "working_capital", amount: 250000 }];
test("confirmed QA funding reconciles the complete million-dollar project", () => {
  const funding = confirmedMemoFunding(row, proceeds)!;
  assert.equal(funding.total_project_cost.value, 1000000);
  assert.equal(funding.borrower_equity.value, 150000);
  assert.equal(funding.borrower_equity_pct.value, 15);
  assert.equal(funding.sources.reduce((s, r) => s + r.amount.value!, 0), 1000000);
  assert.equal(funding.uses.length, 2);
});
test("drafts do not become funding evidence; missing uses are unknown", () => {
  assert.equal(confirmedMemoFunding({ ...row, status: "draft" }, proceeds), null);
  assert.equal(confirmedMemoFunding(row, [])!.total_project_cost.value, null);
  assert.throws(() => confirmedMemoFunding({ ...row, loan_impact: { ...row.loan_impact, equityInjectionAmount: null } }, proceeds), /explicit loan and equity/);
});
test("real funding gaps survive; equity is never invented to balance uses", () => {
  const f = confirmedMemoFunding({ ...row, loan_impact: { ...row.loan_impact, equityInjectionAmount: 0 } }, proceeds)!;
  assert.equal(f.borrower_equity.value, 0);
  assert.equal(f.sources.reduce((s, r) => s + r.amount.value!, 0), 850000);
  assert.equal(f.total_project_cost.value, 1000000);
});
test("seller and other funds are included without replacing explicit financial facts", () => {
  const f = confirmedMemoFunding({ ...row, loan_impact: { ...row.loan_impact, sellerFinancingAmount: 50000, otherSources: [{ description: "Grant", amount: 10000 }] } }, proceeds)!;
  assert.equal(f.sources.reduce((s, r) => s + r.amount.value!, 0), 1060000);
  assert.throws(() => reconcileMemoFunding({ ...f, borrower_equity: { ...f.borrower_equity, value: 200000 } }, f), /Funding conflict/);
  assert.equal(reconcileMemoFunding(f, f).borrower_equity, f.borrower_equity);
});
test("funding edits invalidate memo cache even with unchanged financial facts", () => {
  const base = { snapshotId: null, snapshotUpdatedAt: null, pricingDecisionId: null, pricingUpdatedAt: null, factCount: 33, latestFactUpdatedAt: null };
  const hash = (fundingInputs: unknown) => computeMemoInputHash({ ...base, fundingInputs });
  assert.notEqual(hash({ equity: 150000 }), hash({ equity: 0 }));
  assert.equal(hash({ equity: 150000, loan: 850000 }), hash({ loan: 850000, equity: 150000 }));
});
test("capital uses the same business balance-sheet equity and preserves snapshot authority", () => {
  const args = { snapshot: {}, loanAmount: 850000, businessNetWorth: 850000, ownerEntities: [], research: null, overrides: {}, naicsCode: null } as any;
  assert.match(buildQualitativeAssessment(args).capital.basis, /850,000/);
  assert.doesNotMatch(buildQualitativeAssessment(args).capital.basis, /unavailable/);
  assert.match(buildQualitativeAssessment({ ...args, snapshot: { net_worth: { value_num: -1000 } } }).capital.basis, /Negative net worth/);
});
