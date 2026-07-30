import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { classifyUseOfProceeds } = require("../formFieldStructurer") as typeof import("../formFieldStructurer");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../gateway") as typeof import("../gateway");

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

test("classifyUseOfProceeds returns [] when there are no line items and no total loan amount", async () => {
  const result = await classifyUseOfProceeds({ dealId: "deal-1", totalLoanAmount: null, lineItems: [] });
  assert.deepEqual(result.categorized, []);
});

test("classifyUseOfProceeds with no line items but a known total falls back to the Other bucket carrying that total", async () => {
  const result = await classifyUseOfProceeds({ dealId: "deal-1", totalLoanAmount: 250000, lineItems: [] });
  assert.equal(result.categorized.length, 1);
  assert.equal(result.categorized[0].category, "other");
  assert.equal(result.categorized[0].amount, 250000);
});

test("classifyUseOfProceeds parses a valid structurer response, keeping given amounts unchanged", async () => {
  __setProviderImplForTests("openai", async () => ({
    text: JSON.stringify({
      categorized: [
        { category: "equipment", amount: 100000, description: "CNC machine" },
        { category: "working_capital", amount: 150000, description: "payroll runway" },
      ],
      hasUncategorizedResidue: false,
      rationale: "Two clearly itemized purposes, each with its own stated amount.",
    }),
    tokensIn: 100,
    tokensOut: 50,
  }));

  const result = await classifyUseOfProceeds({
    dealId: "deal-1",
    totalLoanAmount: 250000,
    lineItems: [
      { description: "CNC machine", category: null, amount: 100000 },
      { description: "payroll runway", category: null, amount: 150000 },
    ],
  });

  assert.equal(result.categorized.length, 2);
  assert.equal(result.hasUncategorizedResidue, false);
  const total = result.categorized.reduce((sum, c) => sum + c.amount, 0);
  assert.equal(total, 250000, "categorized amounts must sum to the given total, never invented");
});

test("classifyUseOfProceeds falls back to the Other bucket (nothing invented) on unparseable output", async () => {
  __setProviderImplForTests("openai", async () => ({ text: "not json", tokensIn: 5, tokensOut: 5 }));

  const result = await classifyUseOfProceeds({
    dealId: "deal-1",
    totalLoanAmount: 300000,
    lineItems: [{ description: "general business purposes", category: null, amount: null }],
  });

  assert.equal(result.categorized.length, 1);
  assert.equal(result.categorized[0].category, "other");
  assert.equal(result.categorized[0].amount, 300000, "the fallback must carry the real total, never a guess");
  assert.equal(result.hasUncategorizedResidue, true);
});

test("classifyUseOfProceeds falls back to the Other bucket when the structurer call throws", async () => {
  __setProviderImplForTests("openai", async () => {
    throw new Error("provider unavailable");
  });

  const result = await classifyUseOfProceeds({
    dealId: "deal-1",
    totalLoanAmount: 120000,
    lineItems: [{ description: "misc", category: null, amount: null }],
  });

  assert.equal(result.categorized[0].category, "other");
  assert.equal(result.categorized[0].amount, 120000);
});

test("classifyUseOfProceeds drops entries with an invalid category from a malformed schema response", async () => {
  __setProviderImplForTests("openai", async () => ({
    text: JSON.stringify({
      categorized: [
        { category: "equipment", amount: 50000 },
        { category: "not_a_real_category", amount: 999 },
      ],
      hasUncategorizedResidue: false,
      rationale: "test",
    }),
    tokensIn: 10,
    tokensOut: 10,
  }));

  const result = await classifyUseOfProceeds({
    dealId: "deal-1",
    totalLoanAmount: 50000,
    lineItems: [{ description: "equipment", category: null, amount: 50000 }],
  });

  assert.equal(result.categorized.length, 1);
  assert.equal(result.categorized[0].category, "equipment");
});
