import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("financial output is immutable and run reservations cannot consume unlimited QA capacity", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table deals(id uuid primary key, is_test boolean);
      create table buddy_trident_bundles(id uuid primary key, deal_id uuid, status text);
      create table buddy_sba_packages(id uuid primary key);
      create table deal_model_snapshots(id uuid primary key default gen_random_uuid(),deal_id uuid,bank_id uuid,outputs_hash text);`);
    await db.exec(readFileSync('supabase/migrations/20260827060000_ai_gateway_durable_governance.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/20260827200000_fix_ai_gateway_reserve_ambiguity.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/20260917162449_package_financial_authority.sql','utf8'));
    const deal = '00000000-0000-4000-8000-000000000001';
    const run = '00000000-0000-4000-8000-000000000002';
    await db.query('insert into deals values ($1,true)',[deal]);
    await db.query("insert into buddy_trident_bundles values ($1,$2,'running')",[run,deal]);
    const row = await db.query<{id:string}>("insert into deal_model_snapshots(deal_id,bank_id,package_input_hash,package_output,outputs_hash) values ($1,$1,'inputs','{\"revenue\":100}','hash') returning id",[deal]);
    await assert.rejects(db.query("update deal_model_snapshots set package_output='{\"revenue\":200}' where id=$1",[row.rows[0].id]),/immutable/);
    await assert.rejects(db.query("insert into deal_model_snapshots(deal_id,bank_id,package_input_hash) values ($1,$1,'inputs')",[deal]),/unique/);
    const reserve = await db.query<{allowed:boolean;reservation_id:string}>("select * from reserve_trident_gateway_tokens('verifier',100000,500000,$1)",[run]);
    assert.equal(reserve.rows[0].allowed,true);
    await db.query('select settle_ai_gateway_tokens($1,100000)',[reserve.rows[0].reservation_id]);
    const refused = await db.query<{allowed:boolean}>("select * from reserve_trident_gateway_tokens('verifier',60000,500000,$1)",[run]);
    assert.equal(refused.rows[0].allowed,false);
    const secondRun = '00000000-0000-4000-8000-000000000003';
    const thirdRun = '00000000-0000-4000-8000-000000000004';
    await db.query("insert into buddy_trident_bundles values ($1,$3,'running'),($2,$3,'running')",[secondRun,thirdRun,deal]);
    const secondReservation = await db.query<{allowed:boolean;reservation_id:string}>("select * from reserve_trident_gateway_tokens('verifier',100000,500000,$1)",[secondRun]);
    assert.equal(secondReservation.rows[0].allowed,true);
    await db.query('select settle_ai_gateway_tokens($1,100000)',[secondReservation.rows[0].reservation_id]);
    const qaPoolRefused = await db.query<{allowed:boolean}>("select * from reserve_trident_gateway_tokens('verifier',60000,500000,$1)",[thirdRun]);
    assert.equal(qaPoolRefused.rows[0].allowed,false,"a new QA run cannot evade the aggregate QA allowance");
    const customerDeal = '00000000-0000-4000-8000-000000000005';
    const customerRun = '00000000-0000-4000-8000-000000000006';
    await db.query('insert into deals values ($1,false)',[customerDeal]);
    await db.query("insert into buddy_trident_bundles values ($1,$2,'running')",[customerRun,customerDeal]);
    const customer = await db.query<{allowed:boolean}>("select * from reserve_trident_gateway_tokens('verifier',100000,500000,$1)",[customerRun]);
    assert.equal(customer.rows[0].allowed,true,"QA cannot spend the capacity reserved for customer work");
    const permissions = await db.query<{allowed:boolean}>("select has_function_privilege('anon','reserve_trident_gateway_tokens(text,bigint,bigint,uuid)','execute') as allowed");
    assert.equal(permissions.rows[0].allowed,false);
  } finally { await db.close(); }
});
