import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureOwnerEntity, extractTaxpayerName } from "../documentOwner";

type Owner = { id: string; deal_id: string; entity_type: string; display_name: string };
function fixture(initial: Owner[] = [], readError = false, insertError = false) {
  const owners = [...initial];
  const writes: Partial<Owner>[] = [];
  const sb = {
    from(table: string) {
      assert.equal(table, "ownership_entities");
      const filters: [keyof Owner, string][] = [];
      let pending: Partial<Owner> | undefined;
      const query = {
        select() { return query; },
        eq(key: keyof Owner, value: string) { filters.push([key, value]); return query; },
        insert(row: Partial<Owner>) { pending = row; writes.push(row); return query; },
        async maybeSingle() {
          if (insertError) return { data: null, error: { message: "write failed" } };
          const row = { id: `new-${owners.length}`, ...pending } as Owner;
          owners.push(row);
          return { data: row, error: null };
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({
            data: readError ? null : owners.filter(row => filters.every(([key, value]) => row[key] === value)),
            error: readError ? { message: "read failed" } : null,
          }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { sb, owners, writes };
}
const existing: Owner = { id: "canonical", deal_id: "deal", entity_type: "individual", display_name: "QA Test Owner" };

test("synthetic 1040 name stops before the next Tax year field", () => {
  for (const newline of ["\n", "\r\n"]) {
    assert.equal(extractTaxpayerName(`Taxpayer name   QA TEST OWNER${newline}Tax year   2025`), "QA TEST OWNER");
    assert.equal(extractTaxpayerName(`Taxpayer name:${newline}QA TEST OWNER${newline}Tax year 2025`), "QA TEST OWNER");
  }
  assert.equal(extractTaxpayerName("Taxpayer name: QA TEST OWNER Tax year 2025"), "QA TEST OWNER");
});

test("1040 header and SSN layouts still resolve a name without crossing lines", () => {
  assert.equal(extractTaxpayerName("Your first name and middle initial / Last name\nJane Q. Smith\nAddress"), "Jane Q. Smith");
  assert.equal(extractTaxpayerName("Jane Q Smith 000-00-0000"), "Jane Q Smith");
  assert.equal(extractTaxpayerName("Form 1040\nTax year 2025\nWages 78000"), null);
});

test("all three annual tax returns bind to the existing mixed-case owner", async () => {
  const db = fixture([existing]);
  for (const year of [2023, 2024, 2025]) {
    const name = extractTaxpayerName(`Taxpayer name QA TEST OWNER\nTax year ${year}`);
    assert.equal(await ensureOwnerEntity(db.sb, "deal", name!), "canonical");
  }
  assert.equal(db.owners.length, 1);
  assert.deepEqual(db.writes, []);
});

test("normalizes whitespace and removes label bleed before lookup or insertion", async () => {
  const db = fixture([existing]);
  assert.equal(await ensureOwnerEntity(db.sb, "deal", " QA   TEST OWNER\nTax year"), "canonical");
  assert.equal(await ensureOwnerEntity(db.sb, "deal", "Jane Smith\nTaxpayer address"), "new-1");
  assert.equal(await ensureOwnerEntity(db.sb, "deal", "JANE SMITH"), "new-1");
  assert.deepEqual(db.writes, [{ deal_id: "deal", display_name: "Jane Smith", entity_type: "individual" }]);
});

test("owner reuse is scoped to this deal and entity type", async () => {
  const db = fixture([{ ...existing, deal_id: "other-deal" }, { ...existing, id: "business", entity_type: "entity" }]);
  assert.equal(await ensureOwnerEntity(db.sb, "deal", "QA TEST OWNER"), "new-2");
  assert.equal(db.writes.length, 1);
});

test("does not choose between two existing people with the same name", async () => {
  const db = fixture([existing, { ...existing, id: "second", display_name: "QA TEST OWNER" }]);
  assert.equal(await ensureOwnerEntity(db.sb, "deal", "QA TEST OWNER"), null);
  assert.deepEqual(db.writes, []);
});

test("chooses the canonical identity without silently merging a corrupt stored row", async () => {
  const corrupt = { ...existing, id: "corrupt", display_name: "QA TEST OWNER\nTax year" };
  const db = fixture([existing, corrupt]);
  assert.equal(await ensureOwnerEntity(db.sb, "deal", "QA TEST OWNER"), "canonical");
  assert.deepEqual(db.owners, [existing, corrupt]);
  assert.deepEqual(db.writes, []);
});

test("read failures and invalid names cannot create duplicate owners", async () => {
  const db = fixture([], true);
  assert.equal(await ensureOwnerEntity(db.sb, "deal", "QA TEST OWNER"), null);
  assert.equal(await ensureOwnerEntity(db.sb, "deal", "\nTax year"), null);
  assert.deepEqual(db.writes, []);
});

test("insert failures leave the document unresolved", async () => {
  const db = fixture([], false, true);
  assert.equal(await ensureOwnerEntity(db.sb, "deal", "QA TEST OWNER"), null);
});
