import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const zero = "00000000-0000-0000-0000-000000000000";
const deal = randomUUID(), bank = randomUUID();
const sql = (name: string) => readFileSync(new URL("../../../../supabase/migrations/" + name, import.meta.url), "utf8");
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE deals(id uuid PRIMARY KEY);
    CREATE TABLE deal_documents(id uuid PRIMARY KEY);
    CREATE TABLE deal_spread_runs(id uuid PRIMARY KEY, deal_id uuid, run_reason text, created_at timestamptz, status text);`);
  // PGlite's PostgreSQL has gen_random_uuid built in; the historical pgcrypto
  // extension declaration is unnecessary in this isolated database.
  await db.exec(sql("20260116000001_add_financial_spreads.sql").replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', ""));
  await db.exec(sql("20260206162336_personal_spreads_schema.sql"));
  await db.exec(sql("20260304000002_financial_integrity_hardening.sql"));
  await db.exec(sql("20260502_financial_review_resolution.sql"));
  await db.exec(sql("20260511000001_fix_unique_fact_identity_index.sql"));
  await db.exec(sql("20260911205110_canonical_financial_review.sql"));
  await db.query("INSERT INTO deals VALUES ($1)", [deal]);
  await db.query("INSERT INTO deal_documents VALUES ($1)", [zero]);
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("TRUNCATE financial_review_resolutions, deal_gap_queue, deal_fact_conflicts, deal_financial_facts");
});

async function fact(value = 100, opts: { bank?: string; year?: number; owner?: string; status?: string } = {}) {
  const id = randomUUID(), doc = randomUUID(), year = opts.year ?? 2024;
  await db.query("INSERT INTO deal_documents VALUES ($1)", [doc]);
  await db.query(`INSERT INTO deal_financial_facts(id,deal_id,bank_id,source_document_id,fact_type,fact_key,
    fact_period_start,fact_period_end,fact_value_num,owner_type,owner_entity_id,confidence,resolution_status)
    VALUES ($1,$2,$3,$4,'BTR','NET_INCOME',$5,$6,$7,'DEAL',$8,0.5,$9)`,
    [id,deal,opts.bank ?? bank,doc,year + "-01-01",year + "-12-31",value,opts.owner ?? zero,opts.status ?? "pending"]);
  return id;
}
async function gap(factId: string | null, type = "low_confidence", conflictId: string | null = null) {
  const id = randomUUID();
  await db.query(`INSERT INTO deal_gap_queue(id,deal_id,bank_id,gap_type,fact_type,fact_key,fact_id,conflict_id,description)
    VALUES ($1,$2,$3,$4,$5,'NET_INCOME',$6,$7,'Review net income')`, [id,deal,bank,type,type === "conflict" ? "BTR" : "FINANCIAL",factId,conflictId]);
  return id;
}
async function conflict(ids: string[]) {
  const id = randomUUID();
  await db.query(`INSERT INTO deal_fact_conflicts(id,deal_id,bank_id,fact_type,fact_key,conflicting_fact_ids)
    VALUES ($1,$2,$3,'BTR','NET_INCOME',$4)`, [id,deal,bank,ids]);
  return id;
}
async function review(gapId: string, intent: Record<string, unknown>, scope = bank) {
  const result = await db.query<{ result: any }>("SELECT public.resolve_canonical_financial_review($1,$2,$3,'banker-1','banker',$4) AS result",
    [deal,scope,gapId,JSON.stringify(intent)]);
  return result.rows[0].result;
}
async function row(id: string) {
  return (await db.query<any>("SELECT * FROM deal_financial_facts WHERE id=$1", [id])).rows[0];
}
test("confirmation commits canonical status and exactly one audit, including on retry", async () => {
  const id = await fact(), g = await gap(id), intent = { action: "confirm_value", factId: id };
  const first = await review(g,intent);
  assert.equal(first.ok,true);
  assert.deepEqual(await review(g,intent),first);
  assert.equal((await row(id)).resolution_status,"confirmed");
  assert.equal((await db.query("SELECT * FROM financial_review_resolutions")).rows.length,1);
  await assert.rejects(review(g,{action:"reject_value",factId:id,rationale:"Wrong source document"}),/review_already_resolved/);
});
test("cross-bank gap and unrelated selected fact cannot be confirmed", async () => {
  const id = await fact(), other = await fact(), g = await gap(id);
  await assert.rejects(review(g,{action:"confirm_value",factId:id},randomUUID()),/gap_not_found/);
  await assert.rejects(review(g,{action:"confirm_value",factId:other}),/fact_gap_mismatch/);
  assert.equal((await row(id)).resolution_status,"pending");
});
test("zero override preserves entity, year and source history", async () => {
  const owner = randomUUID(), id = await fact(100,{owner}), g = await gap(id);
  const result = await review(g,{action:"override_value",resolvedValue:0,rationale:"Corrected against original tax return"});
  const manual = await row(result.resolution.factId);
  assert.equal(Number(manual.fact_value_num),0);
  assert.equal(manual.owner_entity_id,owner);
  assert.equal(new Date(manual.fact_period_end).toISOString().slice(0,10),"2024-12-31");
  assert.equal(manual.fact_type,"BTR");
  assert.equal(manual.resolution_status,"overridden");
  assert.equal((await row(id)).is_superseded,true);
  const audit = (await db.query<any>("SELECT * FROM financial_review_resolutions")).rows[0];
  assert.equal(audit.provenance_snapshot.source_fact.id,id);
});
test("audit failure rolls back the replacement, original fact and gap", async () => {
  const id = await fact(), g = await gap(id);
  await db.exec("ALTER TABLE financial_review_resolutions ADD CONSTRAINT test_fail_audit CHECK (false) NOT VALID");
  try {
    await assert.rejects(review(g,{action:"override_value",resolvedValue:5,rationale:"Corrected from source document"}),/test_fail_audit/);
    assert.equal((await row(id)).is_superseded,false);
    assert.equal((await db.query("SELECT * FROM deal_financial_facts")).rows.length,1);
    assert.equal((await db.query<any>("SELECT status FROM deal_gap_queue")).rows[0].status,"open");
  } finally { await db.exec("ALTER TABLE financial_review_resolutions DROP CONSTRAINT test_fail_audit"); }
});
test("selecting a source changes accepted value and rejects only the other source", async () => {
  const a = await fact(100), b = await fact(250), c = await conflict([a,b]), g = await gap(null,"conflict",c);
  const result = await review(g,{action:"choose_source_value",factId:b});
  assert.equal(Number(result.resolution.resolvedValue),250);
  assert.equal((await row(b)).resolution_status,"confirmed");
  assert.equal((await row(a)).is_superseded,true);
});
for (const mismatch of ["year","bank","owner"] as const) {
  test("conflict cannot discard a different " + mismatch, async () => {
    const a = await fact(), b = await fact(250,mismatch === "year" ? {year:2023} : {[mismatch]:randomUUID()});
    const c = await conflict([a,b]), g = await gap(null,"conflict",c);
    await assert.rejects(review(g,{action:"choose_source_value",factId:a}),/conflict_identity_mismatch/);
    assert.equal((await row(a)).resolution_status,"pending");
    assert.equal((await row(b)).is_superseded,false);
  });
}
test("an outsider is not a conflict winner", async () => {
  const a = await fact(), b = await fact(), outsider = await fact(), c = await conflict([a,b]), g = await gap(null,"conflict",c);
  await assert.rejects(review(g,{action:"choose_source_value",factId:outsider}),/selected_fact_not_in_conflict/);
});
test("provided zero needs actual dates and is trusted only after commit", async () => {
  const g = await gap(null,"missing_fact"), intent = {action:"provide_value",resolvedValue:0,rationale:"Banker verified source statement"};
  await assert.rejects(review(g,intent),/financial_period_required/);
  const result = await review(g,{...intent,resolvedPeriodStart:"2024-01-01",resolvedPeriodEnd:"2024-12-31"});
  assert.equal((await row(result.resolution.factId)).resolution_status,"provided");
});
test("override cannot change the year; invalid numbers and rejected evidence fail", async () => {
  const id = await fact(), g = await gap(id);
  await assert.rejects(review(g,{action:"override_value",resolvedValue:100,resolvedPeriodEnd:"2025-12-31",rationale:"Reviewed actual source document"}),/override_must_preserve_period/);
  await assert.rejects(review(g,{action:"override_value",resolvedValue:"NaN",rationale:"Reviewed actual source document"}),/finite_value_required/);
  await db.query("UPDATE deal_financial_facts SET resolution_status='rejected' WHERE id=$1",[id]);
  await assert.rejects(review(g,{action:"confirm_value",factId:id}),/fact_not_reviewable/);
});
test("rejection excludes the fact; follow-up leaves facts unchanged", async () => {
  const id = await fact(), g = await gap(id);
  await review(g,{action:"reject_value",factId:id,rationale:"This is the wrong source document"});
  assert.equal((await row(id)).resolution_status,"rejected");
  await db.exec("TRUNCATE deal_gap_queue");
  const other = await fact(), follow = await gap(other);
  await review(follow,{action:"mark_follow_up",rationale:"Need the signed tax return first"});
  assert.equal((await row(other)).resolution_status,"pending");
  assert.equal((await db.query<any>("SELECT status FROM deal_gap_queue")).rows[0].status,"deferred");
});
test("RPC is unavailable to browser roles and tables have RLS enabled", async () => {
  for (const role of ["anon","authenticated"]) {
    const privileges = await db.query<{ allowed: boolean }>("SELECT has_function_privilege($1,'public.resolve_canonical_financial_review(uuid,uuid,uuid,text,text,jsonb)','EXECUTE') AS allowed",[role]);
    assert.equal(privileges.rows[0].allowed,false);
  }
  const tables = await db.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('deal_gap_queue','deal_fact_conflicts','financial_review_resolutions')");
  assert.equal(tables.rows.length,3);
  assert.ok(tables.rows.every(t => t.relrowsecurity));
});
test("migration retires only unreviewed GCF echoes and remains repeatable", async () => {
  const raw = await fact(), reviewed = await fact(250,{status:"confirmed"});
  await db.query("UPDATE deal_financial_facts SET provenance=$1 WHERE id=ANY($2)",[
    JSON.stringify({source_type:"SPREAD",source_ref:"deal_spreads:GLOBAL_CASH_FLOW:v1"}),[raw,reviewed],
  ]);
  await db.exec(sql("20260911205110_canonical_financial_review.sql"));
  await db.exec(sql("20260911205110_canonical_financial_review.sql"));
  assert.equal((await row(raw)).resolution_status,"system_invalidated");
  assert.equal((await row(reviewed)).resolution_status,"confirmed");
  assert.equal((await row(reviewed)).is_superseded,false);
});
test("server role executes the invoker transaction with normal table grants", async () => {
  const id=await fact(), g=await gap(id);
  await db.exec("GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role; SET ROLE service_role");
  try {
    assert.equal((await review(g,{action:"confirm_value",factId:id})).ok,true);
  } finally { await db.exec("RESET ROLE"); }
});
