import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const deal = "00000000-0000-0000-0000-000000000001";
const bank = "00000000-0000-0000-0000-000000000002";
const other = "00000000-0000-0000-0000-000000000003";
const migration = readFileSync("supabase/migrations/20260918150744_borrower_package_preparation.sql", "utf8");

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table deals(id uuid primary key, bank_id uuid);
    create table deal_loan_requests(deal_id uuid,bank_id uuid,use_of_proceeds jsonb,created_at timestamptz default now());
    create table deal_proceeds_items(id uuid default gen_random_uuid(),deal_id uuid,category text,description text,amount numeric);
    create table buddy_trident_bundles(id uuid default gen_random_uuid(),deal_id uuid,bank_id uuid,mode text,status text,lease_expires_at timestamptz,generated_at timestamptz default now());
    insert into deals values('${deal}','${bank}');
    grant select,update on deals to service_role;
    grant select on buddy_trident_bundles,deal_loan_requests to service_role;
    grant select,insert,update,delete on deal_proceeds_items to service_role;`);
  await db.exec(migration);
  await db.exec(migration); // Production reconciliation can safely be repeated.
  return db;
}
async function claim(db: PGlite, tenant = bank) {
  return (await db.query<{ run: { id?: string; bundleId?: string; reused: boolean } }>(
    "select acquire_borrower_package_preparation($1,$2) run", [deal, tenant])).rows[0].run;
}
async function saveBudget(db: PGlite, amount: number) {
  await db.query("delete from deal_loan_requests");
  await db.query("insert into deal_loan_requests(deal_id,bank_id,use_of_proceeds) values($1,$2,$3)",
    [deal, bank, JSON.stringify([{ category: "equipment", amount, description: "Opening equipment" }])]);
}
async function sync(db: PGlite, run: string) {
  return db.query("select sync_borrower_package_proceeds($1,$2,$3)", [run, deal, bank]);
}

test("atomic preparation admission reuses concurrent clicks, fences stale workers, and enforces tenancy/RLS", async () => {
  const db = await setup();
  try {
    const [a, b] = await Promise.all([claim(db), claim(db)]);
    assert.equal(a.id, b.id); assert.equal(a.reused, false); assert.equal(b.reused, true);
    await assert.rejects(claim(db, other), /Application unavailable/);
    await db.query("update borrower_package_preparations set expires_at = now() - interval '1 minute'");
    const c = await claim(db); assert.notEqual(c.id, a.id);
    await assert.rejects(sync(db, a.id!), /Preparation expired/);
    await db.exec("set role anon");
    await assert.rejects(claim(db), /permission denied/);
    await assert.rejects(db.query("select * from borrower_package_preparations"), /permission denied/);
    await db.exec("reset role; set role service_role");
    assert.equal((await claim(db)).id, c.id);
  } finally { await db.close(); }
});

test("an active final bundle prevents preparation from changing its frozen inputs", async () => {
  const db = await setup();
  try {
    await db.query("insert into buddy_trident_bundles(deal_id,bank_id,mode,status,lease_expires_at) values($1,$2,'final','running',now()+interval '1 hour')", [deal, bank]);
    const result = await claim(db);
    assert.ok(result.bundleId); assert.equal(result.id, undefined);
    assert.equal((await db.query("select * from borrower_package_preparations")).rows.length, 0);
    await db.query("update buddy_trident_bundles set lease_expires_at = now() - interval '1 minute'");
    assert.ok((await claim(db)).id);
  } finally { await db.close(); }
});

test("saved borrower budget reaches the canonical engine without duplication and preserves staff changes", async () => {
  const db = await setup();
  try {
    const run = (await claim(db)).id!;
    await saveBudget(db, 100000);
    await sync(db, run); await sync(db, run);
    assert.equal((await db.query("select * from deal_proceeds_items")).rows.length, 1);
    await saveBudget(db, 120000); await sync(db, run);
    assert.equal(Number((await db.query<{ amount: number }>("select amount from deal_proceeds_items")).rows[0].amount), 120000);
    await db.query("update deal_proceeds_items set amount = 130000");
    await assert.rejects(sync(db, run), /reviewed financing schedule/);
    assert.equal(Number((await db.query<{ amount: number }>("select amount from deal_proceeds_items")).rows[0].amount), 130000);
  } finally { await db.close(); }
});

test("pre-existing reviewed budgets are reused only when they match; invalid budgets cannot replace them", async () => {
  const db = await setup();
  try {
    const run = (await claim(db)).id!;
    await saveBudget(db, 100000);
    await db.query("insert into deal_proceeds_items(deal_id,category,description,amount) values($1,'equipment','Opening equipment',100000)", [deal]);
    await sync(db, run);
    await saveBudget(db, 110000);
    await assert.rejects(sync(db, run), /reviewed financing schedule/);
    await saveBudget(db, 0);
    await assert.rejects(sync(db, run), /greater than zero/);
    await saveBudget(db, -1);
    await assert.rejects(sync(db, run), /budget amounts/);
    assert.equal((await db.query("select * from deal_proceeds_items")).rows.length, 1);
  } finally { await db.close(); }
});
