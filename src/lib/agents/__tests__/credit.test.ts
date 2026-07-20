import { test } from "node:test";
import assert from "node:assert/strict";
import { CreditAgent } from "../credit";

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

test("CreditAgent: no data on file -> zero checks, low confidence, no human review", async () => {
  const { client } = makeFakeSb();
  const agent = new CreditAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.checks.length, 0);
  assert.equal(output.sba_impact, "none");
  assert.equal(output.overall_pass, true);
  assert.equal(agent.calculateConfidence(output, ctx as any), 0.2);
  assert.equal(agent.requiresHumanReview(output), false);
});

test("CreditAgent: FICO below 640 -> mitigable, conditional status", async () => {
  const { client } = makeFakeSb({
    borrower_credit_pulls: [
      { id: "pull-1", deal_id: "deal-1", ownership_entity_id: "owner-1", status: "completed", fico_score: 610 },
    ],
    ownership_entities: [{ id: "owner-1", deal_id: "deal-1", display_name: "Jane Doe" }],
  });
  const agent = new CreditAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.checks.length, 1);
  assert.equal(output.checks[0].check_name, "fico_score");
  assert.equal(output.checks[0].passed, false);
  assert.equal(output.checks[0].borrower_name, "Jane Doe");
  assert.equal(output.sba_impact, "mitigable");
  assert.equal(output.overall_pass, false);
  assert.ok(output.mitigation_options.length > 0);
  assert.equal(agent.requiresHumanReview(output), true);
});

test("CreditAgent: CAIVRS hit -> fatal sba_impact regardless of other checks", async () => {
  const { client } = makeFakeSb({
    borrower_credit_pulls: [
      { id: "pull-1", deal_id: "deal-1", ownership_entity_id: "owner-1", status: "completed", fico_score: 720 },
    ],
    borrower_caivrs_checks: [
      { id: "caivrs-1", deal_id: "deal-1", ownership_entity_id: "owner-1", status: "hit", hit_count: 1 },
    ],
  });
  const agent = new CreditAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.sba_impact, "fatal");
  assert.equal(output.overall_pass, false);
  const caivrsCheck = output.checks.find((c) => c.check_name === "caivrs");
  assert.ok(caivrsCheck);
  assert.equal(caivrsCheck!.passed, false);
  assert.equal(agent.calculateConfidence(output, ctx as any), 0.9);
});

test("CreditAgent: delinquent tradeline -> tradeline_delinquency check with derogatory detail", async () => {
  const { client } = makeFakeSb({
    borrower_credit_tradelines: [
      {
        id: "tl-1",
        deal_id: "deal-1",
        account_type: "credit_card",
        creditor_name: "Test Bank",
        current_balance: 5000,
        is_delinquent: true,
        is_charged_off: false,
        is_in_collection: false,
      },
    ],
  });
  const agent = new CreditAgent(client as any);
  const output = await agent.execute({ deal_id: "deal-1", bank_id: "bank-1" }, ctx);

  assert.equal(output.checks.length, 1);
  assert.equal(output.checks[0].check_name, "tradeline_delinquency");
  assert.equal(output.checks[0].derogatories.length, 1);
  assert.equal(output.sba_impact, "mitigable");
});
