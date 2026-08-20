import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { propagateBorrowerFacts } =
  require("../propagateBorrowerFacts") as typeof import("../propagateBorrowerFacts");
const { fieldsForScope } =
  require("@/lib/sba/forms/borrowerFieldRegistry") as typeof import("@/lib/sba/forms/borrowerFieldRegistry");

// ─── Minimal in-memory Supabase stub ────────────────────────────────────
// Supports exactly the chains propagateBorrowerFacts.ts uses: select/eq/
// order/limit/maybeSingle, update/eq (bare-awaited), insert (bare-awaited
// or chained with select().maybeSingle()), and upsert (bare-awaited).
type Row = Record<string, any>;

/**
 * `failSelect` lets a test force a select to come back `{ data: null,
 * error }`, the way PostgREST answers a request naming a column the table
 * does not have. Without it the stub answered every select successfully,
 * which is exactly why the production duplicate-owner bug (a select that
 * ALWAYS errored) was invisible to this suite. `selects` records every
 * requested column list so a test can assert on it.
 */
type DbOptions = {
  failSelect?: (table: string, columns: string) => { message: string } | null;
};

function makeDb(tables: Record<string, Row[]>, opts: DbOptions = {}) {
  const selects: Array<{ table: string; columns: string }> = [];

  function builder(tableName: string) {
    const rows = tables[tableName] ?? (tables[tableName] = []);
    let filters: Array<[string, any]> = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: any = null;
    let insertedRow: Row | null = null;
    let columns = "*";

    function matches(row: Row) {
      return filters.every(([k, v]) => row[k] === v);
    }

    const q: any = {
      select(cols?: string) {
        // Only a bare select() is a read; insert().select("id") is a write
        // asking for its own row back, and must not be failed or recorded.
        if (op === "select") {
          columns = cols ?? "*";
          selects.push({ table: tableName, columns });
        }
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
        return Promise.resolve(exec(true));
      },
      then(onFulfilled: any, onRejected: any) {
        return exec_promise().then(onFulfilled, onRejected);
      },
    };

    function exec(single: boolean): { data: any; error: { message: string } | null } {
      if (op === "select") {
        const forced = opts.failSelect?.(tableName, columns) ?? null;
        if (forced) return { data: null, error: forced };
        // PostgREST returns an array unless the request is single-row.
        const found = rows.filter(matches);
        return { data: single ? (found[0] ?? null) : found, error: null };
      }
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
      return exec(false);
    }

    return q;
  }

  return { from: builder, selects };
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

test("ownership_entities: spelling variants of one owner do NOT create duplicates", async () => {
  // Production regression. Deal b296dec2 accumulated 14 rows for two people
  // — "Sebrina Colon" x8, "SebrinaColon" x3, "Matthew Paller" x2,
  // "Matthew  Paller" x1 — because matching was an exact display_name
  // comparison. Each phantom owner added an identity-verification blocker
  // that could never be satisfied, so the package could never seal.
  const tables: Record<string, Row[]> = {
    deals: [{ id: "d1", loan_amount: null, loan_type: null, state: null, borrower_id: null }],
    borrower_applications: [],
    deal_financial_facts: [],
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Sebrina Colon", ownership_pct: 100, date_of_birth: null },
    ],
    deal_loan_requests: [],
    borrower_applicant_financials: [],
  };
  const db = makeDb(tables);

  await propagateBorrowerFacts({
    dealId: "d1",
    bankId: "bank1",
    facts: {
      owners: [
        { full_name: "SebrinaColon" },
        { full_name: "sebrina  colon" },
        { full_name: "Sebrina Colon" },
      ],
    },
    sb: db as any,
  });

  assert.equal(
    tables.ownership_entities.length,
    1,
    `expected the three spellings to collapse onto one owner, got ${tables.ownership_entities.length}`,
  );
});

test("ownership_entities: pre-existing duplicates do not trigger further inserts", async () => {
  // Once duplicates existed, `.maybeSingle()` errored on multiple rows, the
  // error was swallowed, and the insert branch ran again — compounding on
  // every save. Matching in memory must tolerate the duplicates already in
  // production and stop the growth.
  const tables: Record<string, Row[]> = {
    deals: [{ id: "d1", loan_amount: null, loan_type: null, state: null, borrower_id: null }],
    borrower_applications: [],
    deal_financial_facts: [],
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Sebrina Colon", ownership_pct: 100, date_of_birth: null },
      { id: "oe2", deal_id: "d1", display_name: "Sebrina Colon", ownership_pct: 100, date_of_birth: null },
    ],
    deal_loan_requests: [],
    borrower_applicant_financials: [],
  };
  const db = makeDb(tables);

  await propagateBorrowerFacts({
    dealId: "d1",
    bankId: "bank1",
    facts: { owners: [{ full_name: "Sebrina Colon", date_of_birth: "1980-01-01" }] },
    sb: db as any,
  });

  assert.equal(
    tables.ownership_entities.length,
    2,
    "must not add a third row when duplicates already exist",
  );
});

// ─── The existing-owner select itself failing ───────────────────────────
// Production root cause. The select's column list was built from the raw
// fieldsForScope("owner"), which carries two deal_pii_records-backed
// entries whose column — `encrypted_payload` — is not on
// ownership_entities and appeared TWICE. Every request 400'd, only `data`
// was destructured, so `existingRow` was always null and the INSERT branch
// ran on every save. Deal b296dec2 grew two fresh duplicates within hours
// of the normalized-name fix deploying, because the matching never ran.

/** Fails any multi-column read of ownership_entities, like the bad select did. */
const failWideOwnerSelect: DbOptions["failSelect"] = (table, columns) =>
  table === "ownership_entities" && columns.split(",").length > 2
    ? { message: `column ownership_entities.encrypted_payload does not exist` }
    : null;

function ownerFixture(): Record<string, Row[]> {
  return {
    deals: [{ id: "d1", loan_amount: null, loan_type: null, state: null, borrower_id: null }],
    borrower_applications: [],
    deal_financial_facts: [],
    ownership_entities: [],
    deal_loan_requests: [],
    borrower_applicant_financials: [],
  };
}

test("ownership_entities: a FAILING existing-owner select never accumulates duplicates", async () => {
  const tables = ownerFixture();
  const db = makeDb(tables, { failSelect: failWideOwnerSelect });
  const facts = {
    owners: [{ full_name: "Sebrina Colon", date_of_birth: "1980-01-01" }],
  };

  const results = [];
  for (let i = 0; i < 4; i += 1) {
    results.push(
      await propagateBorrowerFacts({ dealId: "d1", bankId: "bank1", facts, sb: db as any }),
    );
  }

  assert.equal(
    tables.ownership_entities.length,
    1,
    `four saves with a failing select must leave ONE owner, got ${tables.ownership_entities.length}`,
  );
  // The failure must be reported, not swallowed — silence is what let this
  // run undetected in production for weeks.
  for (const r of results) {
    assert.ok(
      r.errors.some((e) => e.startsWith("ownership_entities(load)")),
      "the select error must be surfaced in errors[]",
    );
  }
  // First save still creates the missing owner (insert-if-missing);
  // later saves recognise it and leave it alone.
  assert.ok(results[0].wrote.some((w) => w.includes("Sebrina Colon") && w.includes("new")));
  for (const r of results.slice(1)) {
    assert.ok(
      !r.wrote.some((w) => w.includes("Sebrina Colon")),
      "an already-present owner must not be re-inserted",
    );
  }
});

test("ownership_entities: a failing select still collapses spelling variants onto one row", async () => {
  const tables = ownerFixture();
  const db = makeDb(tables, { failSelect: failWideOwnerSelect });

  for (let i = 0; i < 3; i += 1) {
    await propagateBorrowerFacts({
      dealId: "d1",
      bankId: "bank1",
      facts: {
        owners: [
          { full_name: "Sebrina Colon" },
          { full_name: "SebrinaColon" },
          { full_name: "sebrina  colon" },
        ],
      },
      sb: db as any,
    });
  }

  assert.equal(
    tables.ownership_entities.length,
    1,
    `normalized-name matching must survive the degraded path, got ${tables.ownership_entities.length}`,
  );
});

test("ownership_entities: a failing select never overwrites an already-set column", async () => {
  // In the degraded path we know WHICH owners exist but not their values.
  // Treating unknown as null would overwrite whatever a banker had filled
  // in, breaking this module's fill-if-null contract.
  const tables = ownerFixture();
  tables.ownership_entities.push({
    id: "oe1",
    deal_id: "d1",
    display_name: "Sebrina Colon",
    date_of_birth: "1970-05-05",
  });
  const db = makeDb(tables, { failSelect: failWideOwnerSelect });

  await propagateBorrowerFacts({
    dealId: "d1",
    bankId: "bank1",
    facts: { owners: [{ full_name: "Sebrina Colon", date_of_birth: "1980-01-01" }] },
    sb: db as any,
  });

  assert.equal(tables.ownership_entities.length, 1);
  assert.equal(
    tables.ownership_entities[0].date_of_birth,
    "1970-05-05",
    "a value already on the row must not be overwritten from a degraded read",
  );
});

test("ownership_entities: when every owner read fails, nothing is inserted", async () => {
  // No usable knowledge of existing owners at all. Inserting here is the
  // blind insert that caused the incident — skip instead.
  const tables = ownerFixture();
  const db = makeDb(tables, {
    failSelect: (table) =>
      table === "ownership_entities" ? { message: "permission denied" } : null,
  });

  let result;
  for (let i = 0; i < 3; i += 1) {
    result = await propagateBorrowerFacts({
      dealId: "d1",
      bankId: "bank1",
      facts: { owners: [{ full_name: "Sebrina Colon" }] },
      sb: db as any,
    });
  }

  assert.equal(
    tables.ownership_entities.length,
    0,
    "must never blind-insert when existing owners cannot be read",
  );
  assert.ok(
    result!.errors.some((e) => e.startsWith("ownership_entities(load-fallback)")),
    "the fallback failure must be surfaced too",
  );
  assert.ok(result!.skipped.some((s) => s.includes("owner lookup failed")));
});

test("ownership_entities: the owner select asks only for real, non-repeated columns", async () => {
  // Guards the root cause directly: `encrypted_payload` belongs to
  // deal_pii_records, does not exist here, and was listed twice.
  const tables = ownerFixture();
  const db = makeDb(tables);

  await propagateBorrowerFacts({
    dealId: "d1",
    bankId: "bank1",
    facts: { owners: [{ full_name: "Sebrina Colon" }] },
    sb: db as any,
  });

  const ownerSelect = db.selects.find(
    (s) => s.table === "ownership_entities" && s.columns.includes("display_name"),
  );
  assert.ok(ownerSelect, "section 5 must read ownership_entities");

  const cols = ownerSelect!.columns.split(",").map((c) => c.trim());
  assert.deepEqual(
    cols.filter((c, i) => cols.indexOf(c) !== i),
    [],
    "no column may be requested twice",
  );

  const realOwnerColumns = new Set([
    "id",
    "display_name",
    ...fieldsForScope("owner")
      .filter((e) => e.sourceTable === "ownership_entities")
      .map((e) => e.sourceColumn),
  ]);
  for (const c of cols) {
    assert.ok(realOwnerColumns.has(c), `column ${c} is not on ownership_entities`);
  }
  assert.ok(!cols.includes("encrypted_payload"), "encrypted_payload is not on this table");
});
