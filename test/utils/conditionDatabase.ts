import { PGlite } from "@electric-sql/pglite";

// Production-shaped PostgreSQL fixture: required legacy code and partial unique index.
export async function setupConditionDatabase() {
  const db = new PGlite();
  await db.exec(`
    create table deals(id text primary key, bank_id text,deal_type text); insert into deals values ('deal','bank','sba_7a_standard');
    create table deal_portal_checklist_items(id serial primary key,deal_id text,code text,title text,description text,group_name text,sort_order int,match_hints jsonb,required boolean,status text default 'missing', unique(deal_id,code));
    create table deal_conditions(id serial primary key,deal_id text,bank_id text not null,code text not null,title text not null,description text,category text not null default 'credit',source text not null check(source in ('policy','manual','system')),source_key text,due_date text,required_docs jsonb default '[]',created_by text,status text default 'open' check(status in ('open','satisfied','waived','rejected')),reminder_subscription_id text);
    create table deal_mitigants(id serial primary key,deal_id text,bank_id text,mitigant_label text,status text);
    create table borrower_document_requests(id serial primary key,deal_id text,bank_id text,title text not null,description text,category text,status text,due_at text);
    create table deal_documents(deal_id text,canonical_type text,doc_year int,status text);
    create table signed_documents(deal_id text,bank_id text,form_code text,signature_completed_at text);
    create table deal_collateral_items(deal_id text,item_type text);
    create table deal_missing_docs(id serial primary key,deal_id text,key text,label text,severity text,reason text,status text,meta jsonb,unique(deal_id,key));
    create table deal_condition_evidence(condition_id int references deal_conditions(id),kind text,label text,detail text,payload jsonb);
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
