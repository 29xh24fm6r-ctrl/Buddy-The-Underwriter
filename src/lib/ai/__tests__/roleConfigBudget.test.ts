import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { getRoleConfig } from "../roleConfig";
import { packageBudgetBlockers } from "../../brokerage/trident/packageBudgetPolicy";

const original = process.env.AI_GATEWAY_BUDGET_VERIFIER;
afterEach(() => {
  mock.restoreAll();
  if (original === undefined) delete process.env.AI_GATEWAY_BUDGET_VERIFIER;
  else process.env.AI_GATEWAY_BUDGET_VERIFIER = original;
});

test("authorized capacity admits the QA run, then restores the normal budget at UTC rollover", () => {
  delete process.env.AI_GATEWAY_BUDGET_VERIFIER;
  const clock = mock.method(Date, "now", () => Date.parse("2026-09-23T22:00:00Z"));
  const dailyLimit = getRoleConfig("verifier").dailyTokenBudget;
  assert.equal(dailyLimit, 530_000);
  assert.deepEqual(packageBudgetBlockers({role:"verifier", dailyLimit,
    consumed:114538, reserved:0, qaUsed:114538, runUsed:0, isTest:true, required:150000}), []);
  clock.mock.mockImplementation(() => Date.parse("2026-09-24T00:00:00Z"));
  assert.equal(getRoleConfig("verifier").dailyTokenBudget, 500_000);
  clock.mock.mockImplementation(() => Date.parse("2026-09-22T23:59:59Z"));
  assert.equal(getRoleConfig("verifier").dailyTokenBudget, 500_000);
});

test("temporary capacity preserves custom limits and the per-run cap", () => {
  mock.method(Date, "now", () => Date.parse("2026-09-23T22:00:00Z"));
  for (const budget of [10, 400000, 750000]) {
    process.env.AI_GATEWAY_BUDGET_VERIFIER = String(budget);
    assert.equal(getRoleConfig("verifier").dailyTokenBudget, budget);
  }
  assert.equal(getRoleConfig("generator").dailyTokenBudget, Number(process.env.AI_GATEWAY_BUDGET_GENERATOR) || 2_000_000);
  assert.ok(packageBudgetBlockers({role:"verifier",dailyLimit:530000,consumed:150000,
    reserved:0,qaUsed:150000,runUsed:150000,isTest:true,required:150000})
    .some(message => message.includes("package run allowance 150000")));
});
