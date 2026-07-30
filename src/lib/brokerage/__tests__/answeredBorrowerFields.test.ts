import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { loadAnsweredBorrowerFieldKeys } =
  require("../answeredBorrowerFields") as typeof import("../answeredBorrowerFields");

// ─── Minimal in-memory Supabase stub ────────────────────────────────────
// Supports exactly the chains loadAnsweredBorrowerFieldKeys uses: select/
// eq/neq/order/limit/maybeSingle. Column-projection is ignored (returns the
// whole matching row) — fine, since the reader only reads keys off it.
type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  function builder(tableName: string) {
    const rows = tables[tableName] ?? [];
    let filters: Array<{ op: "eq" | "neq"; col: string; val: any }> = [];

    function matches(row: Row) {
      return filters.every(({ op, col, val }) => (op === "eq" ? row[col] === val : row[col] !== val));
    }

    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        filters.push({ op: "eq", col, val });
        return q;
      },
      neq(col: string, val: any) {
        filters.push({ op: "neq", col, val });
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      maybeSingle() {
        const found = rows.find(matches) ?? null;
        return Promise.resolve({ data: found, error: null });
      },
    };
    return q;
  }
  return { from: builder };
}

test("loadAnsweredBorrowerFieldKeys: empty DB state answers nothing", async () => {
  const sb = makeDb({});
  const answered = await loadAnsweredBorrowerFieldKeys("deal-1", sb);
  assert.equal(answered.size, 0);
});

test("loadAnsweredBorrowerFieldKeys: reads business facts from borrowers via deals.borrower_id", async () => {
  const sb = makeDb({
    deals: [{ id: "deal-1", borrower_id: "borrower-1", loan_amount: 250000 }],
    borrowers: [{ id: "borrower-1", legal_name: "Acme LLC", ein: null }],
  });
  const answered = await loadAnsweredBorrowerFieldKeys("deal-1", sb);
  assert.ok(answered.has("business.legal_name"));
  assert.ok(answered.has("loan.amount_requested"), "deals.loan_amount answers loan.amount_requested");
  assert.equal(answered.has("business.ein"), false, "null column must not count as answered");
});

test("loadAnsweredBorrowerFieldKeys: use_of_proceeds comes from borrower_applications.loan_purpose", async () => {
  const sb = makeDb({
    deals: [{ id: "deal-1", borrower_id: null, loan_amount: null }],
    borrower_applications: [{ deal_id: "deal-1", loan_purpose: "Working capital" }],
  });
  const answered = await loadAnsweredBorrowerFieldKeys("deal-1", sb);
  assert.ok(answered.has("loan.use_of_proceeds"));
  assert.equal(answered.has("loan.amount_requested"), false);
});

test("loadAnsweredBorrowerFieldKeys: owner-scope fields come from the first individual ownership_entities row", async () => {
  const sb = makeDb({
    deals: [{ id: "deal-1", borrower_id: null, loan_amount: null }],
    ownership_entities: [
      { id: "owner-1", deal_id: "deal-1", entity_type: "individual", display_name: "Jane Doe", title: "CEO" },
    ],
  });
  const answered = await loadAnsweredBorrowerFieldKeys("deal-1", sb);
  assert.ok(answered.has("owner.full_name"));
  assert.ok(answered.has("owner.title"));
});

test("loadAnsweredBorrowerFieldKeys: pfs-scope fields come from borrower_applicant_financials keyed by the owner's id", async () => {
  const sb = makeDb({
    deals: [{ id: "deal-1", borrower_id: null, loan_amount: null }],
    ownership_entities: [
      { id: "owner-1", deal_id: "deal-1", entity_type: "individual", display_name: "Jane Doe" },
    ],
    borrower_applicant_financials: [{ applicant_id: "owner-1", net_worth: 500000 }],
  });
  const answered = await loadAnsweredBorrowerFieldKeys("deal-1", sb);
  assert.ok(answered.has("pfs.net_worth"));
});

test("loadAnsweredBorrowerFieldKeys: entity-scope fields come from a non-individual ownership_entities row", async () => {
  const sb = makeDb({
    deals: [{ id: "deal-1", borrower_id: null, loan_amount: null }],
    ownership_entities: [
      { id: "entity-1", deal_id: "deal-1", entity_type: "llc", display_name: "Holdco LLC", entity_ein: "99-1234567" },
    ],
  });
  const answered = await loadAnsweredBorrowerFieldKeys("deal-1", sb);
  assert.ok(answered.has("entity.legal_name"));
  assert.ok(answered.has("entity.ein"));
});

test("loadAnsweredBorrowerFieldKeys: a read failure degrades to an empty set (non-fatal)", async () => {
  const sb = {
    from() {
      throw new Error("boom");
    },
  };
  const answered = await loadAnsweredBorrowerFieldKeys("deal-1", sb as any);
  assert.equal(answered.size, 0);
});
