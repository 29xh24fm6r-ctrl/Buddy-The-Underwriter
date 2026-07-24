import { test } from "node:test";
import assert from "node:assert/strict";
import { ManagementAgent } from "../management";

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
      limit() {
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

test("ManagementAgent: no principals on file -> empty, requires review, low confidence", async () => {
  const { client } = makeFakeSb({ deals: [{ id: "deal-1", borrower_name: "Acme LLC" }] });
  const agent = new ManagementAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.principals.length, 0);
  assert.equal(agent.requiresHumanReview(output), true);
  assert.equal(agent.calculateConfidence(output, ctx as any), 0.2);
});

test("ManagementAgent: documented management profile -> real experience, no concerns", async () => {
  const { client } = makeFakeSb({
    deals: [{ id: "deal-1", borrower_name: "Acme LLC" }],
    deal_management_profiles: [
      {
        deal_id: "deal-1",
        bank_id: "bank-1",
        person_name: "Jane Doe",
        title: "CEO",
        ownership_pct: 60,
        years_experience: 12,
        industry_experience: "12 years running a similar business",
        prior_business_experience: "Founded and sold a prior company in the same industry",
        resume_summary: "Experienced operator",
        credit_relevance: "Strong personal credit history",
      },
    ],
  });
  const agent = new ManagementAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.principals.length, 1);
  const p = output.principals[0];
  assert.equal(p.principal_name, "Jane Doe");
  assert.equal(p.years_experience, 12);
  assert.equal(p.concerns.length, 0);
  assert.equal(p.industry_match, true);
  assert.equal(agent.requiresHumanReview(output), false);
});

test("ManagementAgent: owner with no bio on file -> pending bio flagged as a concern", async () => {
  const { client } = makeFakeSb({
    deals: [{ id: "deal-1", borrower_name: "Acme LLC" }],
    ownership_entities: [{ id: "owner-1", deal_id: "deal-1", display_name: "John Smith", ownership_pct: 100 }],
  });
  const agent = new ManagementAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.principals.length, 1);
  assert.equal(output.principals[0].concerns.length, 1);
  assert.match(output.principals[0].concerns[0], /not yet documented/);
  assert.equal(agent.requiresHumanReview(output), true);
});
