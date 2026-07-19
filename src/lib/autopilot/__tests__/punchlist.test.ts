import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePunchlist } from "../punchlist";

/**
 * Regression coverage for the deal_conditions column bug: this file
 * previously read condition.assignee/severity/condition_title/
 * condition_description/reason, none of which exist on the real
 * deal_conditions schema (title/description/category/status/source/
 * source_key) — every condition-derived PunchlistItem field was silently
 * undefined. These tests exercise the real column names.
 */
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
      in(col: string, vals: unknown[]) {
        filters.push((row) => vals.includes(row[col]));
        return builder;
      },
      then(resolve: any) {
        const rows = state[name].filter((r) => filters.every((f) => f(r)));
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  return { client: { from: table }, state };
}

test("generatePunchlist: no data anywhere -> empty, zero counts, no crash", async () => {
  const { client } = makeFakeSb();
  const result = await generatePunchlist("deal-1", "bank-1", { sb: client as any });
  assert.equal(result.total_count, 0);
  assert.equal(result.blocking_count, 0);
});

test("generatePunchlist: mitigant-driven (policy-source) condition -> borrower_action using real columns", async () => {
  const { client } = makeFakeSb({
    deal_conditions: [
      {
        id: "cond-1",
        deal_id: "deal-1",
        status: "open",
        source: "policy",
        category: "other",
        title: "Provide updated bank statements",
        description: "Last 3 months required",
      },
    ],
  });
  const result = await generatePunchlist("deal-1", "bank-1", { sb: client as any });

  assert.equal(result.borrower_actions.length, 1);
  const item = result.borrower_actions[0];
  assert.equal(item.title, "Provide updated bank statements");
  assert.equal(item.description, "Last 3 months required");
  assert.equal(item.priority, "medium");
  assert.equal(item.blocking, false);
});

test("generatePunchlist: legal-category system condition -> banker_action, high priority, blocking", async () => {
  const { client } = makeFakeSb({
    deal_conditions: [
      {
        id: "cond-2",
        deal_id: "deal-1",
        status: "open",
        source: "system",
        category: "legal",
        title: "Resolve title defect",
        description: "Lien search flagged an unresolved judgment",
      },
    ],
  });
  const result = await generatePunchlist("deal-1", "bank-1", { sb: client as any });

  assert.equal(result.banker_actions.length, 1);
  const item = result.banker_actions[0];
  assert.equal(item.title, "Resolve title defect");
  assert.equal(item.priority, "high");
  assert.equal(item.blocking, true);
  assert.equal(item.sba_vs_bank, "sba");
});
