import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runBankNightlyTasks } = require("../runBankNightlyTasks") as typeof import("../runBankNightlyTasks");
type Dependencies = import("../runBankNightlyTasks").Dependencies;

function deps(overrides: Partial<Dependencies> = {}) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      aggregatePortfolio: async () => {
        calls.push("portfolio");
        return {} as any;
      },
      detectPolicyDrift: async () => {
        calls.push("drift");
      },
      suggestPolicyUpdates: async () => {
        calls.push("suggestions");
      },
      ...overrides,
    },
  };
}

test("empty portfolios are an expected skip and do not block later governance", async () => {
  const d = deps({
    aggregatePortfolio: async () => {
      d.calls.push("portfolio");
      const error = new Error("No final decisions found");
      Object.assign(error, { code: "NO_FINAL_PORTFOLIO_DECISIONS" });
      throw error;
    },
  });

  const result = await runBankNightlyTasks("bank-1", d.value);

  assert.deepEqual(d.calls, ["portfolio", "drift", "suggestions"]);
  assert.deepEqual(result, {
    bank_id: "bank-1",
    status: "success",
    portfolio: "skipped_no_final_decisions",
    policy_drift: "completed",
    policy_suggestions: "completed",
  });
});

test("real portfolio failures remain loud and stop dependent work", async () => {
  const d = deps({
    aggregatePortfolio: async () => {
      d.calls.push("portfolio");
      throw new Error("database unavailable");
    },
  });

  const result = await runBankNightlyTasks("bank-2", d.value);

  assert.deepEqual(d.calls, ["portfolio"]);
  assert.equal(result.status, "error");
  assert.equal(result.error, "database unavailable");
  assert.equal(result.policy_drift, "not_run");
});

test("later governance failures preserve completed-step evidence", async () => {
  const d = deps({
    suggestPolicyUpdates: async () => {
      d.calls.push("suggestions");
      throw new Error("provider unavailable");
    },
  });

  const result = await runBankNightlyTasks("bank-3", d.value);

  assert.deepEqual(d.calls, ["portfolio", "drift", "suggestions"]);
  assert.equal(result.status, "error");
  assert.equal(result.portfolio, "aggregated");
  assert.equal(result.policy_drift, "completed");
  assert.equal(result.policy_suggestions, "not_run");
});
