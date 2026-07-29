import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { computeCovenantCounts } = require("../covenantCounter") as typeof import("../covenantCounter");

// ─── Minimal in-memory Supabase stub, same shape convention as
// answeredBorrowerFields.test.ts (select/eq/neq/order/limit/maybeSingle). ──
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

test("computeCovenantCounts: nothing answered yet — all zero", async () => {
  const db = makeDb({});
  const counts = await computeCovenantCounts("deal-1", db);
  assert.deepEqual(counts, { borrowerAnswered: 0, systemAnswered: 0, totalAnswered: 0 });
});

test("computeCovenantCounts: a field answered via canonical state AND present in extracted_facts counts as borrower-answered", async () => {
  const db = makeDb({
    deals: [{ id: "deal-1", borrower_id: "borrower-1", loan_amount: 250000 }],
    borrowers: [{ id: "borrower-1", legal_name: "Acme LLC" }],
    borrower_concierge_sessions: [
      { deal_id: "deal-1", extracted_facts: { business: { legal_name: "Acme LLC" }, loan: { amount_requested: 250000 } } },
    ],
  });

  const counts = await computeCovenantCounts("deal-1", db);
  // Both legal_name (borrowers.legal_name) and loan.amount_requested (deals.loan_amount)
  // are canonically answered AND present in the conversation facts bag.
  assert.equal(counts.borrowerAnswered, 2);
  assert.equal(counts.totalAnswered, 2);
  assert.equal(counts.systemAnswered, 0);
});

test("computeCovenantCounts: a field answered canonically but NOT in the conversation facts bag counts as system-answered", async () => {
  const db = makeDb({
    deals: [{ id: "deal-1", borrower_id: "borrower-1", loan_amount: 250000 }],
    borrowers: [{ id: "borrower-1", legal_name: "Acme LLC" }],
    // No borrower_concierge_sessions row at all — nothing came from a chat.
  });

  const counts = await computeCovenantCounts("deal-1", db);
  assert.equal(counts.totalAnswered, 2);
  assert.equal(counts.borrowerAnswered, 0);
  assert.equal(counts.systemAnswered, 2);
});

test("computeCovenantCounts: borrower + system counts always sum to the total", async () => {
  const db = makeDb({
    deals: [{ id: "deal-1", borrower_id: "borrower-1", loan_amount: 250000 }],
    borrowers: [{ id: "borrower-1", legal_name: "Acme LLC", ein: "12-3456789" }],
    borrower_concierge_sessions: [
      { deal_id: "deal-1", extracted_facts: { business: { legal_name: "Acme LLC" } } }, // borrower only mentioned legal_name, not EIN
    ],
  });

  const counts = await computeCovenantCounts("deal-1", db);
  assert.equal(counts.borrowerAnswered + counts.systemAnswered, counts.totalAnswered);
  assert.equal(counts.totalAnswered, 3, "legal_name + ein + loan.amount_requested");
  assert.equal(counts.borrowerAnswered, 1, "only legal_name was ever in the conversation facts bag");
  assert.equal(counts.systemAnswered, 2, "ein + loan.amount_requested came from elsewhere");
});
