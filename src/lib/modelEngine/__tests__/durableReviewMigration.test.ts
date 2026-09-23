import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { packageBudgetBlockers } from "../../brokerage/trident/packageBudgetPolicy";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("database policy admits the observed review, enforces run/QA caps and checkpoints exclude stale or foreign workers", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table deals(id uuid primary key, is_test boolean, bank_id uuid);
      create table buddy_trident_bundles(id uuid primary key, deal_id uuid, status text);
      create table buddy_sba_packages(id uuid primary key,deal_id uuid);
      create table buddy_feasibility_studies(id uuid primary key,deal_id uuid,bank_id uuid);
      create table deal_model_snapshots(id uuid primary key default gen_random_uuid(),deal_id uuid,bank_id uuid,outputs_hash text);`);
    for (const file of ['20260827060000_ai_gateway_durable_governance.sql', '20260827200000_fix_ai_gateway_reserve_ambiguity.sql', '20260917162449_package_financial_authority.sql', '20260923223818_durable_package_review.sql'])
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    await db.query('insert into deals values ($1,true,$2)', [id(1), id(2)]);
    await db.query("insert into buddy_trident_bundles values ($1,$2,'running'),($3,$2,'running')", [id(3), id(1), id(4)]);
    await db.query('insert into buddy_feasibility_studies values ($1,$2,$3)', [id(5), id(1), id(2)]);
    const policy = (await db.query<{policy: Record<string, number>}>('select trident_package_budget_policy() as policy')).rows[0].policy;
    assert.equal(policy.generator, 150000);
    const reserve = async (n: number, run = id(3)) => (await db.query<{allowed: boolean; reservation_id: string}>("select * from reserve_trident_gateway_tokens('verifier',$1,1000000,$2)", [n, run])).rows[0];
    const first = await reserve(119189);
    assert.equal(first.allowed, true);
    await db.query('select settle_ai_gateway_tokens($1,119189)', [first.reservation_id]);
    assert.deepEqual(packageBudgetBlockers({ role: 'verifier', dailyLimit: 1000000, consumed: 119189, reserved: 0, qaUsed: 119189, runUsed: 119189, required: policy.verifier, runAllowance: policy.verifier, isTest: true }), []);
    const thirdReview = await reserve(40973);
    assert.equal(thirdReview.allowed, true, 'exact production denial now fits');
    assert.equal((await reserve(150000)).allowed, false, 'active reservation still counts toward 300k run limit');
    await db.query('select settle_ai_gateway_tokens($1,13447)', [thirdReview.reservation_id]);
    const remaining = await reserve(300000 - 119189 - 13447);
    assert.equal(remaining.allowed, true);
    assert.equal((await reserve(1)).allowed, false);
    const qa = await reserve(200000, id(4));
    assert.equal(qa.allowed, true);
    assert.equal((await reserve(1, id(4))).allowed, false, 'QA half of daily capacity is still hard enforced');
    await assert.rejects(db.query("select * from reserve_trident_gateway_tokens('verifier',-1,1000000,$1)", [id(3)]), /Invalid/);

    const checkpoint = async (action: string, owner = id(6), revision = 0, hash = 'a'.repeat(64), state: unknown = null, bank = id(2)) =>
      (await db.query<{result: {state: unknown;revision: number}}>('select institutional_review_checkpoint($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as result',
        [action, bank, id(1), 'feasibility', id(5), hash, owner, revision, state == null ? null : JSON.stringify(state)])).rows[0].result;
    const claimed = await checkpoint('claim');
    const state = { version: 1, phase: 'review', cycle: 2, sections: [{ key: 'a', text: 'Saved repair 2' }], remaining: [{ severity: 'critical' }] };
    const saved = await checkpoint('save', id(6), claimed.revision, 'a'.repeat(64), state);
    await assert.rejects(checkpoint('claim', id(7)), /already owned/);
    await assert.rejects(checkpoint('save', id(6), claimed.revision, 'a'.repeat(64), state), /ownership lost/);
    await assert.rejects(checkpoint('claim', id(7), 0, 'a'.repeat(64), null, id(99)), /tenant mismatch/);
    await checkpoint('release', id(6), saved.revision);
    const resumed = await checkpoint('claim', id(7));
    assert.deepEqual(resumed.state, state);
    await db.exec("update institutional_review_checkpoints set lease_until=now()-interval '1 second'");
    const replacement = await checkpoint('claim', id(8));
    assert.deepEqual(replacement.state, state);
    await assert.rejects(checkpoint('save', id(7), resumed.revision, 'a'.repeat(64), state), /ownership lost/);
    await checkpoint('release', id(8), replacement.revision);
    const changed = await checkpoint('claim', id(9), 0, 'b'.repeat(64));
    assert.equal(changed.state, null, 'changed facts cannot reuse repaired prose or prior verdict');
    const rights = await db.query<{allowed: boolean; rls: boolean}>(`select
      has_function_privilege('authenticated','institutional_review_checkpoint(text,uuid,uuid,text,uuid,text,uuid,bigint,jsonb)','execute') as allowed,
      (select relrowsecurity from pg_class where relname='institutional_review_checkpoints') as rls`);
    assert.equal(rights.rows[0].allowed, false);
    assert.equal(rights.rows[0].rls, true);
  } finally { await db.close(); }
});
