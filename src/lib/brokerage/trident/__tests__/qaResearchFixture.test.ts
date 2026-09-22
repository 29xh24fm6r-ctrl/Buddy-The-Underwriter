import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const deal = "e6c35197-349b-402d-be4c-49cbc87e2f7e";
const bank = "d8a4cf3a-7575-45df-9926-f31eaed99f3c";
const borrower = "00000000-0000-0000-0000-000000000001";
const fixture = readFileSync("scripts/qa/commission-7brew-research.sql", "utf8");
// Column types/defaults and CHECK/PK/unique constraints captured read-only from
// production on 2026-09-22. This fixture intentionally omits external FKs/RLS;
// those are covered by the schema/access suites, not this data-seeding test.
const schema = readFileSync("src/lib/brokerage/trident/__tests__/qaResearchSchema.fixture.sql", "utf8");
test("7 Brew fixture is repeat-safe, test-only, and refuses an active package", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema extensions;
      create function extensions.digest(text,text) returns bytea language sql as 'select sha256(convert_to($1,''UTF8''))';
      create table deals(id uuid,bank_id uuid,borrower_id uuid,is_test boolean,test_suite text,test_run_id text);
      create table borrowers(id uuid,legal_name text,city text,state text);
      create table buddy_trident_bundles(deal_id uuid,status text,lease_expires_at timestamptz);
      insert into deals values('${deal}','${bank}','${borrower}',false,null,null);
      insert into borrowers values('${borrower}','QA 7 Brew Franchise Test LLC','Flowery Branch','GA');`);
    await db.exec(schema);
    await assert.rejects(db.exec(fixture), /qa_deal_not_found/);
    await db.exec("rollback");
    await db.query("update deals set is_test=true");
    await db.query("insert into buddy_trident_bundles values($1,'running',now()+interval '1 hour')", [deal]);
    await assert.rejects(db.exec(fixture), /qa_package_run_active/);
    await db.exec("rollback");
    await db.query("delete from buddy_trident_bundles");
    await db.exec(fixture); await db.exec(fixture);
    const missions = await db.query<any>("select * from buddy_research_missions");
    assert.equal(missions.rows.length, 1);
    assert.equal(missions.rows[0].subject.synthetic_qa, true);
    assert.equal((await db.query("select * from buddy_research_sources")).rows.length, 3);
    assert.equal((await db.query("select * from buddy_research_facts")).rows.length, 5);
    await db.query("delete from buddy_research_facts");
    await assert.rejects(db.exec(fixture), /incomplete_existing_run/);
    await db.exec("rollback");
    assert.equal((await db.query("select * from buddy_research_missions")).rows.length, 1);
  } finally { await db.close(); }
});
