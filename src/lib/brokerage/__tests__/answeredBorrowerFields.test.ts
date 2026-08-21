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

// ─── Column-accurate stub ───────────────────────────────────────────────
//
// The stub above ignores the column list by design ("fine, since the reader
// only reads keys off it"). That assumption is what hid this bug: the owner
// select named `encrypted_payload`, a deal_pii_records column that does not
// exist on ownership_entities, so PostgREST rejected the request. Only
// `data` was destructured, so the failure was indistinguishable from "this
// borrower has answered nothing" and the concierge re-asked every owner and
// PFS question they had already answered.
//
// These tests use a stub that DOES read the column list and returns a
// PostgREST error when a column is not on the table — the one behaviour
// needed to see the defect.

const { fieldsForScope } =
  require("@/lib/sba/forms/borrowerFieldRegistry") as typeof import("@/lib/sba/forms/borrowerFieldRegistry");

/** Real ownership_entities columns, verified against the live schema. */
const OWNERSHIP_ENTITIES_COLUMNS = new Set<string>([
  "id", "deal_id", "display_name", "entity_type", "ownership_pct", "created_at",
  ...fieldsForScope("owner")
    .filter((e) => e.sourceTable === "ownership_entities")
    .map((e) => e.sourceColumn),
  ...fieldsForScope("entity")
    .filter((e) => e.sourceTable === "ownership_entities")
    .map((e) => e.sourceColumn),
]);

function makeColumnAccurateDb(tables: Record<string, Row>) {
  const selects: Array<{ table: string; columns: string }> = [];
  function builder(table: string) {
    let columns = "*";
    const q: any = {
      select(cols?: string) { columns = cols ?? "*"; selects.push({ table, columns }); return q; },
      eq: () => q,
      neq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        if (table === "ownership_entities") {
          const asked = columns.split(",").map((c) => c.trim()).filter(Boolean);
          const bad = asked.filter((c) => !OWNERSHIP_ENTITIES_COLUMNS.has(c));
          if (bad.length > 0) {
            return {
              data: null,
              error: { message: `column ownership_entities.${bad[0]} does not exist` },
              count: null, status: 400,
            };
          }
        }
        return { data: tables[table] ?? null, error: null, count: null, status: 200 };
      },
    };
    return q;
  }
  return { sb: { from: builder }, selects };
}

test("owner answers are recognised — the select must not name a foreign column", async () => {
  const ownerEntry = fieldsForScope("owner").find(
    (e) => e.sourceTable === "ownership_entities" && e.sourceColumn === "date_of_birth",
  )!;

  const { sb, selects } = makeColumnAccurateDb({
    deals: { borrower_id: null, loan_amount: null },
    borrower_applications: { loan_purpose: null },
    ownership_entities: { id: "oe1", date_of_birth: "1980-01-01" },
  });

  const answered = await loadAnsweredBorrowerFieldKeys("d1", sb as any);

  const ownerSelect = selects.find(
    (s) => s.table === "ownership_entities" && s.columns.includes("date_of_birth"),
  );
  assert.ok(ownerSelect, "the owner read must happen");
  assert.ok(
    !ownerSelect!.columns.includes("encrypted_payload"),
    "encrypted_payload belongs to deal_pii_records and breaks this query",
  );
  assert.ok(
    answered.has(ownerEntry.factPath),
    `a stored owner answer must be reported as answered, got: ${[...answered].join(",")}`,
  );
});

test("no requested column is outside the table it is read from", async () => {
  const { sb, selects } = makeColumnAccurateDb({
    deals: { borrower_id: null, loan_amount: null },
    borrower_applications: { loan_purpose: null },
    ownership_entities: { id: "oe1" },
  });
  await loadAnsweredBorrowerFieldKeys("d1", sb as any);

  for (const s of selects.filter((x) => x.table === "ownership_entities")) {
    const cols = s.columns.split(",").map((c) => c.trim()).filter(Boolean);
    assert.deepEqual(
      cols.filter((c, i) => cols.indexOf(c) !== i), [],
      "no column may be requested twice",
    );
    for (const c of cols) {
      assert.ok(OWNERSHIP_ENTITIES_COLUMNS.has(c), `column ${c} is not on ownership_entities`);
    }
  }
});

test("PFS answers survive — they are gated on the owner read succeeding", async () => {
  // ownerId comes from the owner row. When that read failed, ownerId was
  // undefined and the PFS block never ran, so PFS questions were re-asked too.
  const pfsEntry = fieldsForScope("pfs")[0];
  const { sb } = makeColumnAccurateDb({
    deals: { borrower_id: null, loan_amount: null },
    borrower_applications: { loan_purpose: null },
    ownership_entities: { id: "oe1" },
    borrower_applicant_financials: { [pfsEntry.sourceColumn]: 1234 },
  });

  const answered = await loadAnsweredBorrowerFieldKeys("d1", sb as any);
  assert.ok(
    answered.has(pfsEntry.factPath),
    `a stored PFS answer must be reported as answered, got: ${[...answered].join(",")}`,
  );
});
