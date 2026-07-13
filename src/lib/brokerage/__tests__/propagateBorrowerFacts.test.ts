import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { propagateBorrowerFacts } =
  require("../propagateBorrowerFacts") as typeof import("../propagateBorrowerFacts");

// ─── Minimal in-memory Supabase stub ────────────────────────────────────
// Supports exactly the chains propagateBorrowerFacts.ts uses: select/eq/
// order/limit/maybeSingle, update/eq (bare-awaited), insert (bare-awaited
// or chained with select().maybeSingle()), and upsert (bare-awaited).
type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  function builder(tableName: string) {
    const rows = tables[tableName] ?? (tables[tableName] = []);
    let filters: Array<[string, any]> = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: any = null;
    let insertedRow: Row | null = null;

    function matches(row: Row) {
      return filters.every(([k, v]) => row[k] === v);
    }

    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      upsert(p: any, _opts?: any) {
        op = "upsert";
        payload = p;
        return q;
      },
      update(p: any) {
        op = "update";
        payload = p;
        return q;
      },
      insert(p: any) {
        op = "insert";
        payload = p;
        insertedRow = { id: `gen-${rows.length + 1}`, ...p };
        return q;
      },
      maybeSingle() {
        return Promise.resolve(exec());
      },
      then(onFulfilled: any, onRejected: any) {
        return exec_promise().then(onFulfilled, onRejected);
      },
    };

    function exec(): { data: Row | null; error: null } {
      if (op === "insert") {
        rows.push(insertedRow!);
        return { data: insertedRow, error: null };
      }
      const found = rows.find(matches) ?? null;
      if (op === "update" && found) Object.assign(found, payload);
      if (op === "upsert") {
        const existing = rows.find((r) => r.deal_id === payload.deal_id);
        if (existing) Object.assign(existing, payload);
        else rows.push({ ...payload });
      }
      return { data: found, error: null };
    }

    async function exec_promise() {
      return exec();
    }

    return q;
  }

  return { from: builder };
}

test("borrowers: fills currently-null phone, never overwrites already-set legal_name", async () => {
  const db = makeDb({
    deals: [{ id: "d1", loan_amount: null, loan_type: null, state: null, borrower_id: "b1" }],
    borrowers: [{ id: "b1", legal_name: "Existing Legal Name LLC", phone: null }],
    borrower_applications: [],
    deal_financial_facts: [],
    ownership_entities: [],
    deal_loan_requests: [],
  });

  const result = await propagateBorrowerFacts({
    dealId: "d1",
    bankId: "bank1",
    facts: {
      business: { legal_name: "Attempted Overwrite LLC", phone: "555-0100" },
    },
    sb: db as any,
  });

  const row = await db.from("borrowers").select("*").eq("id", "b1").maybeSingle();
  assert.equal(row.data.legal_name, "Existing Legal Name LLC", "existing value must not be overwritten");
  assert.equal(row.data.phone, "555-0100", "null column must be filled");
  assert.ok(result.wrote.some((w) => w.startsWith("borrowers(")));
});

test("ownership_entities: new owner is inserted; existing owner is fill-if-null updated, not overwritten", async () => {
  const db = makeDb({
    deals: [{ id: "d1", loan_amount: null, loan_type: null, state: null, borrower_id: null }],
    borrower_applications: [],
    deal_financial_facts: [],
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Jane Doe", ownership_pct: 60, date_of_birth: null },
    ],
    deal_loan_requests: [],
    borrower_applicant_financials: [],
  });

  const result = await propagateBorrowerFacts({
    dealId: "d1",
    bankId: "bank1",
    facts: {
      owners: [
        { full_name: "Jane Doe", ownership_pct: 10, date_of_birth: "1980-01-01" },
        { full_name: "John Smith", ownership_pct: 40 },
      ],
    },
    sb: db as any,
  });

  const jane = await db.from("ownership_entities").select("*").eq("display_name", "Jane Doe").maybeSingle();
  assert.equal(jane.data.ownership_pct, 60, "existing ownership_pct must not be overwritten");
  assert.equal(jane.data.date_of_birth, "1980-01-01", "null column must be filled");

  const john = await db.from("ownership_entities").select("*").eq("display_name", "John Smith").maybeSingle();
  assert.ok(john.data, "new owner must be inserted");
  assert.equal(john.data.ownership_pct, 40);
  assert.equal(john.data.entity_type, "individual");

  assert.ok(result.wrote.some((w) => w.includes("Jane Doe")));
  assert.ok(result.wrote.some((w) => w.includes("John Smith") && w.includes("new")));
});

test("deal_loan_requests: fills currently-null column when a row exists; skips cleanly when none exists", async () => {
  const dbWithRow = makeDb({
    deals: [{ id: "d1", loan_amount: null, loan_type: null, state: null, borrower_id: null }],
    borrower_applications: [],
    deal_financial_facts: [],
    ownership_entities: [],
    deal_loan_requests: [{ id: "lr1", deal_id: "d1", created_at: "2026-01-01", standby_creditor_name: null }],
    borrower_applicant_financials: [],
  });

  const result = await propagateBorrowerFacts({
    dealId: "d1",
    bankId: "bank1",
    facts: { loan: { standby_creditor_name: "Prior Owner LLC" } },
    sb: dbWithRow as any,
  });

  const lr = await dbWithRow.from("deal_loan_requests").select("*").eq("id", "lr1").maybeSingle();
  assert.equal(lr.data.standby_creditor_name, "Prior Owner LLC");
  assert.ok(result.wrote.some((w) => w.startsWith("deal_loan_requests(")));

  const dbNoRow = makeDb({
    deals: [{ id: "d2", loan_amount: null, loan_type: null, state: null, borrower_id: null }],
    borrower_applications: [],
    deal_financial_facts: [],
    ownership_entities: [],
    deal_loan_requests: [],
    borrower_applicant_financials: [],
  });

  const result2 = await propagateBorrowerFacts({
    dealId: "d2",
    bankId: "bank1",
    facts: { loan: { standby_creditor_name: "Prior Owner LLC" } },
    sb: dbNoRow as any,
  });

  assert.ok(!result2.errors.length, "must not error when no deal_loan_requests row exists yet");
  assert.ok(result2.skipped.some((s) => s.startsWith("deal_loan_requests")));
});
