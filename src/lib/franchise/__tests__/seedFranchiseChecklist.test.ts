import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const { seedFranchiseChecklist } = createRequire(import.meta.url)("../seedFranchiseChecklist");

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create table deals(id text primary key, bank_id text); insert into deals values ('deal','bank');
    create table deal_portal_checklist_items(id serial primary key,deal_id text,code text,title text,description text,group_name text,sort_order int,match_hints jsonb,required boolean,status text default 'missing', unique(deal_id,code));
    create table deal_conditions(id serial primary key,deal_id text,bank_id text,title text,description text,category text,source text,source_key text,required_docs jsonb,status text default 'open',verified_doc_id text);
    create unique index deal_conditions_deal_source_key_uidx on deal_conditions(deal_id,source,source_key) where source_key is not null;
  `);
  let fail = "";
  const sb = { from(table: string) {
    let op = "select", payload: any, conflict = "", columns = "*";
    const filters: Array<[string, unknown]> = [];
    const run = async (single: boolean) => {
      if (table === fail) return { data: null, error: { code: "failure", message: "unavailable" } };
      const args: unknown[] = [];
      const bind = (v: unknown) => { args.push(v && typeof v === "object" ? JSON.stringify(v) : v); return `$${args.length}`; };
      const where = () => filters.map(([k,v]) => `${k}=${bind(v)}`).join(" and ") || "true";
      try {
        let sql: string;
        if (op === "select") sql = `select ${columns} from ${table} where ${where()}`;
        else if (op === "update") sql = `update ${table} set ${Object.entries(payload).map(([k,v])=>`${k}=${bind(v)}`).join(",")} where ${where()} returning id`;
        else {
          const rows = Array.isArray(payload) ? payload : [payload];
          const keys = Object.keys(rows[0]);
          sql = `insert into ${table}(${keys.join(",")}) values ${rows.map(row=>`(${keys.map(k=>bind(row[k])).join(",")})`).join(",")}`;
          if (op === "upsert") sql += ` on conflict (${conflict}) do update set ${keys.map(k=>`${k}=excluded.${k}`).join(",")}`;
          sql += " returning id";
        }
        const result = await db.query(sql, args);
        return { data: single ? result.rows[0] ?? null : result.rows, error: null };
      } catch (error: any) { return { data: null, error: { code: error.code, message: error.message } }; }
    };
    const q: any = { select: (v: string) => { columns = v; return q; }, eq: (k: string,v: unknown) => { filters.push([k,v]); return q; },
      update: (v: unknown) => { op = "update"; payload=v; return q; }, insert: (v: unknown) => { op="insert"; payload=v; return q; },
      upsert: (v: unknown,o: any) => { op="upsert"; payload=v; conflict=o.onConflict; return q; },
      maybeSingle: () => run(true), single: () => run(true), then: (resolve: any) => run(false).then(resolve) };
    return q;
  } };
  return { db, sb, fail: (table: string) => { fail=table; } };
}
const params = { dealId: "deal", bankId: "bank", brandName: "7 BREW" };
test("real partial unique index supports first seed, concurrent repeats, and preserves completed evidence", async () => {
  const { db, sb } = await setup();
  try {
    assert.deepEqual(await seedFranchiseChecklist(sb, params), { ok: true });
    await db.exec("update deal_conditions set status='satisfied',verified_doc_id='reviewed-document' where source_key='franchise_fdd'; update deal_portal_checklist_items set status='received' where code='FRANCHISE_DISCLOSURE_DOCUMENT';");
    const results = await Promise.all([seedFranchiseChecklist(sb, { ...params, brandName: "Updated brand" }), seedFranchiseChecklist(sb, { ...params, brandName: "Updated brand" })]);
    assert.ok(results.every(r=>r.ok));
    assert.equal((await db.query("select * from deal_conditions")).rows.length, 3);
    assert.equal((await db.query("select * from deal_portal_checklist_items")).rows.length, 3);
    assert.deepEqual((await db.query("select status,verified_doc_id from deal_conditions where source_key='franchise_fdd'")).rows, [{ status: "satisfied", verified_doc_id: "reviewed-document" }]);
    assert.equal((await db.query<{status:string}>("select status from deal_portal_checklist_items where code='FRANCHISE_DISCLOSURE_DOCUMENT'")).rows[0].status, "received");
  } finally { await db.close(); }
});
test("initial concurrent inserts recover unique conflicts without duplication", async () => {
  const { db, sb } = await setup();
  try {
    assert.ok((await Promise.all([seedFranchiseChecklist(sb, params), seedFranchiseChecklist(sb, params)])).every(r=>r.ok));
    assert.equal((await db.query("select * from deal_conditions")).rows.length, 3);
  } finally { await db.close(); }
});
test("read/write failures and a foreign tenant cannot be reported as checklist success", async () => {
  const { db, sb, fail } = await setup();
  try {
    assert.deepEqual(await seedFranchiseChecklist(sb, { ...params, bankId: "other-bank" }), { ok: false });
    assert.equal((await db.query("select * from deal_portal_checklist_items")).rows.length, 0);
    for (const table of ["deals", "deal_portal_checklist_items", "deal_conditions"]) {
      fail(table); assert.deepEqual(await seedFranchiseChecklist(sb, params), { ok: false });
    }
  } finally { await db.close(); }
});
