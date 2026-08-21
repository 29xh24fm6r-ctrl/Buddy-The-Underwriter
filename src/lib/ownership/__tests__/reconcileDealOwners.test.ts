import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { reconcileDealOwners, ownerRemovalBlocker } =
  require("../reconcileDealOwners") as typeof import("../reconcileDealOwners");

type Row = Record<string, any>;

/**
 * Minimal in-memory Supabase stub covering exactly the chains
 * reconcileDealOwners uses: select/eq/order (+ head-count), update/eq/eq,
 * insert().select().maybeSingle(), and delete/eq/eq.
 */
function makeDb(tables: Record<string, Row[]>) {
  let nextId = 1;

  function builder(tableName: string) {
    const rows = tables[tableName] ?? (tables[tableName] = []);
    let filters: Array<[string, any]> = [];
    let op: "select" | "update" | "insert" | "delete" = "select";
    let payload: any = null;
    let insertedRow: Row | null = null;
    let wantCount = false;

    const matches = (row: Row) => filters.every(([k, v]) => row[k] === v);

    const exec = (single: boolean) => {
      if (op === "select") {
        const found = rows.filter(matches);
        if (wantCount) return { data: null, error: null, count: found.length };
        return { data: single ? (found[0] ?? null) : found, error: null, count: found.length };
      }
      if (op === "insert") {
        rows.push(insertedRow!);
        return { data: insertedRow, error: null, count: null };
      }
      if (op === "delete") {
        const doomed = rows.filter(matches);
        for (const row of doomed) rows.splice(rows.indexOf(row), 1);
        return { data: null, error: null, count: doomed.length };
      }
      const found = rows.find(matches) ?? null;
      if (found) Object.assign(found, payload);
      return { data: found, error: null, count: null };
    };

    const q: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) wantCount = true;
        return q;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        return q;
      },
      order: () => q,
      limit: () => q,
      update(p: any) {
        op = "update";
        payload = p;
        return q;
      },
      insert(p: any) {
        op = "insert";
        insertedRow = { id: `new-${nextId++}`, ...p };
        return q;
      },
      delete() {
        op = "delete";
        return q;
      },
      maybeSingle: () => Promise.resolve(exec(true)),
      then: (onOk: any, onErr: any) => Promise.resolve(exec(false)).then(onOk, onErr),
    };
    return q;
  }

  return { from: builder };
}

/** The tables ownerRemovalBlocker probes, all empty unless a test fills one. */
function emptyReferenceTables(): Record<string, Row[]> {
  return {
    signed_documents: [],
    signing_requests: [],
    sba_package_run_items: [],
    deal_pii_records: [],
    borrower_sam_exclusions: [],
    borrower_irs_transcript_requests: [],
  };
}

test("REGRESSION b296dec2: dropping the duplicate takes the cap table from 149% to 100%", async () => {
  const tables: Record<string, Row[]> = {
    ...emptyReferenceTables(),
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Sebrina Colon", ownership_pct: 51, entity_type: "individual" },
      { id: "oe2", deal_id: "d1", display_name: "Matthew Paller", ownership_pct: 49, entity_type: "individual" },
      { id: "oe3", deal_id: "d1", display_name: "matt paller", ownership_pct: 49, entity_type: "individual" },
    ],
  };
  const db = makeDb(tables);

  const result = await reconcileDealOwners({
    sb: db as any,
    dealId: "d1",
    owners: [
      { id: "oe1", full_name: "Sebrina Colon", ownership_pct: 51 },
      { id: "oe2", full_name: "Matthew Paller", ownership_pct: 49 },
    ],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.removed, ["matt paller"]);
  assert.equal(tables.ownership_entities.length, 2);
  const total = tables.ownership_entities.reduce((s, r) => s + Number(r.ownership_pct), 0);
  assert.equal(total, 100);
});

test("an edit corrects a percentage that fill-if-null propagation never could", async () => {
  const tables: Record<string, Row[]> = {
    ...emptyReferenceTables(),
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Matthew Paller", ownership_pct: 49, entity_type: "individual" },
    ],
  };
  const db = makeDb(tables);

  const result = await reconcileDealOwners({
    sb: db as any,
    dealId: "d1",
    owners: [{ id: "oe1", full_name: "Matthew J. Paller", ownership_pct: 100 }],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.updated, ["Matthew J. Paller"]);
  assert.equal(tables.ownership_entities[0].display_name, "Matthew J. Paller");
  assert.equal(tables.ownership_entities[0].ownership_pct, 100);
});

test("an owner submitted without an id lands on the near-matching row, not a new one", async () => {
  const tables: Record<string, Row[]> = {
    ...emptyReferenceTables(),
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Matthew Paller", ownership_pct: 49, entity_type: "individual" },
    ],
  };
  const db = makeDb(tables);

  await reconcileDealOwners({
    sb: db as any,
    dealId: "d1",
    owners: [{ full_name: "matt paller", ownership_pct: 100 }],
  });

  assert.equal(tables.ownership_entities.length, 1, "must not become a second row");
  assert.equal(tables.ownership_entities[0].id, "oe1");
});

test("a genuinely new owner is inserted", async () => {
  const tables: Record<string, Row[]> = {
    ...emptyReferenceTables(),
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Sebrina Colon", ownership_pct: 100, entity_type: "individual" },
    ],
  };
  const db = makeDb(tables);

  const result = await reconcileDealOwners({
    sb: db as any,
    dealId: "d1",
    owners: [
      { id: "oe1", full_name: "Sebrina Colon", ownership_pct: 51 },
      { full_name: "Matthew Paller", ownership_pct: 49 },
    ],
  });

  assert.deepEqual(result.inserted, ["Matthew Paller"]);
  assert.equal(tables.ownership_entities.length, 2);
  assert.equal(tables.ownership_entities[1].entity_type, "individual");
});

test("an owner who has already signed is RETAINED, not deleted", async () => {
  const tables: Record<string, Row[]> = {
    ...emptyReferenceTables(),
    signed_documents: [{ id: "s1", signer_ownership_entity_id: "oe2" }],
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Sebrina Colon", ownership_pct: 51, entity_type: "individual" },
      { id: "oe2", deal_id: "d1", display_name: "Matthew Paller", ownership_pct: 49, entity_type: "individual" },
    ],
  };
  const db = makeDb(tables);

  const result = await reconcileDealOwners({
    sb: db as any,
    dealId: "d1",
    owners: [{ id: "oe1", full_name: "Sebrina Colon", ownership_pct: 100 }],
  });

  assert.deepEqual(result.removed, []);
  assert.equal(result.retained.length, 1);
  assert.equal(result.retained[0].display_name, "Matthew Paller");
  assert.match(result.retained[0].reason, /already signed/);
  assert.equal(tables.ownership_entities.length, 2, "the signed owner must survive");
  // The caller is told the truth about what the deal holds, duplicates and
  // all, rather than the list the borrower hoped for.
  assert.equal(result.owners.length, 2);
});

test("an equity-owning ENTITY is never swept up by the removal pass", async () => {
  const tables: Record<string, Row[]> = {
    ...emptyReferenceTables(),
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Sebrina Colon", ownership_pct: 51, entity_type: "individual" },
      { id: "oe2", deal_id: "d1", display_name: "Holdco LLC", ownership_pct: 49, entity_type: "entity" },
    ],
  };
  const db = makeDb(tables);

  const result = await reconcileDealOwners({
    sb: db as any,
    dealId: "d1",
    owners: [{ id: "oe1", full_name: "Sebrina Colon", ownership_pct: 51 }],
  });

  assert.deepEqual(result.removed, []);
  assert.ok(tables.ownership_entities.some((r) => r.display_name === "Holdco LLC"));
});

test("an unrecognized id falls through to name matching instead of failing", async () => {
  // The row was deleted in another tab. Failing the whole save would be a
  // dead end for the borrower.
  const tables: Record<string, Row[]> = {
    ...emptyReferenceTables(),
    ownership_entities: [
      { id: "oe1", deal_id: "d1", display_name: "Sebrina Colon", ownership_pct: 100, entity_type: "individual" },
    ],
  };
  const db = makeDb(tables);

  const result = await reconcileDealOwners({
    sb: db as any,
    dealId: "d1",
    owners: [{ id: "stale-id", full_name: "Sebrina Colon", ownership_pct: 100 }],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(tables.ownership_entities.length, 1);
});

test("ownerRemovalBlocker returns null when nothing depends on the owner", async () => {
  const db = makeDb(emptyReferenceTables());
  assert.equal(await ownerRemovalBlocker(db as any, "oe1"), null);
});

test("ownerRemovalBlocker names the reliance it found", async () => {
  const db = makeDb({
    ...emptyReferenceTables(),
    deal_pii_records: [{ id: "p1", ownership_entity_id: "oe1" }],
  });
  const blocker = await ownerRemovalBlocker(db as any, "oe1");
  assert.match(String(blocker), /personal information/);
});
