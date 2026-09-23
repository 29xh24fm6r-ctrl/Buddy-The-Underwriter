import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync("supabase/migrations/20260923142259_reconcile_synthetic_qa_tax_owner.sql", "utf8");
const deal = "00000000-0000-0000-0000-000000000001";
const canonical = "00000000-0000-0000-0000-000000000002";
const duplicate = "00000000-0000-0000-0000-000000000003";
let db: PGlite;
before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE deals(id uuid PRIMARY KEY, is_test boolean);
    CREATE TABLE ownership_entities(id uuid PRIMARY KEY, deal_id uuid, display_name text,
      entity_type text, ownership_pct numeric, meta_json jsonb);
    CREATE TABLE deal_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deal_id uuid,
      original_filename text, assigned_owner_id uuid);
    CREATE TABLE deal_financial_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deal_id uuid,
      owner_entity_id uuid, owner_type text, source_document_id uuid, fact_key text, value numeric);
    CREATE TABLE deal_events(deal_id uuid, kind text, payload jsonb);
    CREATE TABLE protected_records(applicant_id uuid REFERENCES ownership_entities(id) ON DELETE CASCADE);
    CREATE TABLE legacy_records(owner_entity_id uuid);
  `);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`TRUNCATE deals, ownership_entities, deal_documents, deal_financial_facts,
    deal_events, protected_records, legacy_records;
    INSERT INTO deals VALUES('${deal}', true);
    INSERT INTO ownership_entities VALUES
      ('${canonical}','${deal}','QA Test Owner','individual',100,'{"source":"borrower_portal"}'),
      ('${duplicate}','${deal}',E'QA TEST OWNER\nTax year','individual',null,'{}');
    INSERT INTO deal_documents(deal_id,original_filename,assigned_owner_id)
      SELECT '${deal}', 'QA-SYNTHETIC-Form-1040-' || year || '.pdf', '${duplicate}'
      FROM generate_series(2023,2025) year;
    INSERT INTO deal_financial_facts(deal_id,owner_entity_id,owner_type,source_document_id,fact_key,value)
      SELECT '${deal}', '${duplicate}', 'PERSONAL', d.id, 'FACT_' || n, n * 100
      FROM deal_documents d CROSS JOIN generate_series(1,8) n;`);
});
async function data() {
  return (await db.query<{ snapshot: unknown }>(`SELECT jsonb_build_object(
    'owners',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM ownership_entities o),
    'documents',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM deal_documents d),
    'facts',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM deal_financial_facts f),
    'events',(SELECT jsonb_agg(to_jsonb(e)) FROM deal_events e)) AS snapshot`)).rows[0].snapshot;
}

test("reconciles the synthetic fixture without losing facts and can be replayed", async () => {
  const factsBefore = (await db.query("SELECT id, fact_key, value, source_document_id FROM deal_financial_facts ORDER BY id")).rows;
  await db.exec(sql);
  assert.deepEqual((await db.query("SELECT id FROM ownership_entities")).rows, [{ id: canonical }]);
  assert.deepEqual((await db.query("SELECT DISTINCT assigned_owner_id FROM deal_documents")).rows, [{ assigned_owner_id: canonical }]);
  assert.deepEqual((await db.query("SELECT DISTINCT owner_entity_id FROM deal_financial_facts")).rows, [{ owner_entity_id: canonical }]);
  assert.deepEqual((await db.query("SELECT id, fact_key, value, source_document_id FROM deal_financial_facts ORDER BY id")).rows, factsBefore);
  const audit = (await db.query<{ payload: { removed_owner: { id: string }; document_ids: string[]; financial_fact_ids: string[] } }>("SELECT payload FROM deal_events")).rows[0].payload;
  assert.equal(audit.removed_owner.id, duplicate);
  assert.equal(audit.document_ids.length, 3);
  assert.equal(audit.financial_fact_ids.length, 24);
  const repaired = await data();
  await db.exec(sql);
  assert.deepEqual(await data(), repaired);
});

test("does not touch a real borrower's records even with identical names", async () => {
  await db.exec("UPDATE deals SET is_test=false");
  const original = await data();
  await db.exec(sql);
  assert.deepEqual(await data(), original);
});

for (const table of ["protected_records", "legacy_records"]) {
  test(`unexpected ${table} references abort and roll back document/fact moves`, async () => {
    await db.exec(`INSERT INTO ${table} VALUES('${duplicate}')`);
    const original = await data();
    await assert.rejects(() => db.exec(sql), /still referenced/);
    assert.deepEqual(await data(), original);
    assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 1);
  });
}

test("unexpected document or financial data aborts without partial changes", async () => {
  await db.exec("UPDATE deal_documents SET original_filename='unrelated.pdf'");
  const original = await data();
  await assert.rejects(() => db.exec(sql), /three known QA tax returns/);
  assert.deepEqual(await data(), original);
});

test("a changed canonical owner prevents consolidation", async () => {
  await db.exec("UPDATE ownership_entities SET ownership_pct=50 WHERE ownership_pct=100");
  const original = await data();
  await assert.rejects(() => db.exec(sql), /one canonical owner/);
  assert.deepEqual(await data(), original);
});
