import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDealStructureFacts } from "../dealStructureFacts";

const byKey = (writes: Array<{ canonicalKey: string; value: number }>) =>
  Object.fromEntries(writes.map((w) => [w.canonicalKey, w.value]));

describe("computeDealStructureFacts", () => {
  // Deal c0f6caab: $960k purchase loan, $1.2M industrial building at 80%
  // advance, $240k down, no proceeds schedule and no total_project_cost.
  const loanRequest = {
    requested_amount: 960_000,
    approved_amount: null,
    property_value: 1_200_000,
    purchase_price: 1_200_000,
    down_payment: 240_000,
    total_project_cost: null,
  };

  it("derives the full memo-readiness set from request + collateral schedule", () => {
    const { writes, notes } = computeDealStructureFacts({
      loanRequest,
      collateral: [{ item_type: "real_estate", estimated_value: 1_200_000, advance_rate: 0.8 }],
      proceedsTotal: null,
    });
    const f = byKey(writes);
    assert.equal(f.BANK_LOAN_TOTAL, 960_000);
    assert.equal(f.TOTAL_PROJECT_COST, 1_200_000); // purchase price
    assert.equal(f.BORROWER_EQUITY, 240_000);
    assert.equal(f.BORROWER_EQUITY_PCT, 0.2);
    assert.equal(f.COLLATERAL_GROSS_VALUE, 1_200_000);
    assert.equal(f.COLLATERAL_NET_VALUE, 960_000);
    assert.equal(f.COLLATERAL_DISCOUNTED_VALUE, 960_000);
    assert.equal(f.LTV_GROSS, 0.8);
    assert.equal(f.LTV_NET, 1);
    assert.equal(f.COLLATERAL_DISCOUNTED_COVERAGE, 1);
    assert.deepEqual(notes, []);
    // Fact addressing comes from the canonical registry.
    const ltv = writes.find((w) => w.canonicalKey === "LTV_NET")!;
    assert.equal(ltv.factType, "COLLATERAL");
    assert.equal(ltv.factKey, "LTV_NET");
  });

  it("uses the default advance rate when the schedule leaves it blank", () => {
    const { writes } = computeDealStructureFacts({
      loanRequest,
      collateral: [{ item_type: "real_estate", estimated_value: 1_200_000, advance_rate: null }],
      proceedsTotal: null,
    });
    assert.equal(byKey(writes).COLLATERAL_NET_VALUE, 960_000);
  });

  it("prefers an explicit project cost, then proceeds, then price, then loan + down payment", () => {
    const base = { collateral: [], proceedsTotal: null };
    assert.equal(
      byKey(computeDealStructureFacts({ ...base, loanRequest: { ...loanRequest, total_project_cost: 1_300_000 } }).writes).TOTAL_PROJECT_COST,
      1_300_000,
    );
    assert.equal(
      byKey(computeDealStructureFacts({ ...base, loanRequest, proceedsTotal: 1_250_000 }).writes).TOTAL_PROJECT_COST,
      1_250_000,
    );
    assert.equal(
      byKey(computeDealStructureFacts({ ...base, loanRequest: { ...loanRequest, purchase_price: null, property_value: null } }).writes).TOTAL_PROJECT_COST,
      1_200_000, // 960k + 240k
    );
  });

  it("falls back to the request's property value for gross LTV when there is no schedule", () => {
    const { writes, notes } = computeDealStructureFacts({ loanRequest, collateral: [], proceedsTotal: null });
    const f = byKey(writes);
    assert.equal(f.COLLATERAL_GROSS_VALUE, 1_200_000);
    assert.equal(f.LTV_GROSS, 0.8);
    assert.equal(f.COLLATERAL_NET_VALUE, undefined);
    assert.ok(notes.includes("no_collateral_schedule:net_values_unavailable"));
  });

  it("writes nothing without a loan amount", () => {
    const { writes, notes } = computeDealStructureFacts({ loanRequest: null, collateral: [], proceedsTotal: null });
    assert.equal(writes.length, 0);
    assert.deepEqual(notes, ["no_loan_request_amount"]);
  });
});
