import { test } from "node:test";
import assert from "node:assert/strict";
import { CollateralAgent } from "../collateral";

function makeFakeSb(tables: Record<string, any[]> = {}) {
  const state: Record<string, any[]> = { ...tables };

  function table(name: string) {
    if (!state[name]) state[name] = [];
    const filters: Array<(row: any) => boolean> = [];
    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      maybeSingle: async () => {
        const rows = state[name].filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: any) {
        const rows = state[name].filter((r) => filters.every((f) => f(r)));
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  return { client: { from: table } };
}

const ctx = { deal_id: "deal-1", bank_id: "bank-1" };

test("CollateralAgent: no collateral items -> pending status, requires review", async () => {
  const { client } = makeFakeSb({ deals: [{ id: "deal-1", loan_amount: 500_000 }] });
  const agent = new CollateralAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.collateral_types.length, 0);
  assert.equal(agent.requiresHumanReview(output), true);
  assert.equal(agent.calculateConfidence(output, ctx as any), 0.2);
});

test("CollateralAgent: real estate collateral within LTV policy -> sop_compliant", async () => {
  const { client } = makeFakeSb({
    deals: [{ id: "deal-1", loan_amount: 300_000 }],
    deal_collateral_items: [
      {
        id: "item-1",
        deal_id: "deal-1",
        item_type: "real_estate",
        description: "HQ building",
        estimated_value: 500_000,
        lien_position: 1,
      },
    ],
  });
  const agent = new CollateralAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  // lendable value = 500_000 * 0.80 (real_estate default advance rate) = 400_000
  // ltv = 300_000 / 400_000 = 0.75 <= 0.80 policy limit
  assert.equal(output.sop_compliant, true);
  assert.equal(output.shortfall, false);
  assert.equal(agent.requiresHumanReview(output), false);
});

test("CollateralAgent: insufficient collateral -> shortfall, not sop_compliant, requires review", async () => {
  const { client } = makeFakeSb({
    deals: [{ id: "deal-1", loan_amount: 1_000_000 }],
    deal_collateral_items: [
      {
        id: "item-1",
        deal_id: "deal-1",
        item_type: "equipment",
        description: "Machinery",
        estimated_value: 200_000,
        lien_position: 1,
      },
    ],
  });
  const agent = new CollateralAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.sop_compliant, false);
  assert.equal(output.shortfall, true);
  assert.equal(agent.requiresHumanReview(output), true);
});

test("CollateralAgent: junior lien position -> flagged for review even when LTV compliant", async () => {
  const { client } = makeFakeSb({
    deals: [{ id: "deal-1", loan_amount: 100_000 }],
    deal_collateral_items: [
      {
        id: "item-1",
        deal_id: "deal-1",
        item_type: "real_estate",
        description: "Second lien building",
        estimated_value: 1_000_000,
        lien_position: 2,
      },
    ],
  });
  const agent = new CollateralAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.sop_compliant, true);
  assert.equal(agent.requiresHumanReview(output), true);
});
