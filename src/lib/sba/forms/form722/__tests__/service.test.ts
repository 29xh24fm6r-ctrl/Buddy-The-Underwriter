import { test } from "node:test";
import assert from "node:assert/strict";
import { getForm722Status, acknowledgeForm722 } from "@/lib/sba/forms/form722/service";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ k: string; v: any }> = [];
  _i: Row[] | null = null;
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ k, v });
    return this;
  }
  is(k: string, v: any) {
    this.filters.push({ k, v });
    return this;
  }
  order(_k: string, _o?: any) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  insert(p: Row | Row[]) {
    const rows = Array.isArray(p) ? p : [p];
    const withIds = rows.map((r) => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString(), ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...withIds);
    this._i = withIds;
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve: any, reject?: any) {
    return Promise.resolve({ data: this._i ?? this.rows(), error: null }).then(resolve, reject);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) rows = rows.filter((r) => r[f.k] === f.v);
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { bank_document_templates: [], deal_events: [], ...seed };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

test("getForm722Status: no template, no acknowledgment -> posterAvailable=false, acknowledged=false", async () => {
  const db = new FakeDb();
  const status = await getForm722Status("d1", db as any);
  assert.equal(status.posterAvailable, false);
  assert.equal(status.acknowledged, false);
});

test("getForm722Status: template ingested -> posterAvailable=true with storage path", async () => {
  const db = new FakeDb({
    bank_document_templates: [{ bank_id: null, template_key: "SBA_722", is_active: true, file_path: "sba-templates/722.pdf" }],
  });
  const status = await getForm722Status("d1", db as any);
  assert.equal(status.posterAvailable, true);
  assert.equal(status.posterStoragePath, "sba-templates/722.pdf");
});

test("acknowledgeForm722: first acknowledgment -> ok, writes deal_events row", async () => {
  const db = new FakeDb();
  const result = await acknowledgeForm722("d1", "b1", db as any, { acknowledgedByUserId: "u1" });
  assert.equal(result.ok, true);
  assert.equal(db.tables.deal_events.length, 1);
  assert.equal(db.tables.deal_events[0].kind, "form_722.acknowledged");

  const status = await getForm722Status("d1", db as any);
  assert.equal(status.acknowledged, true);
});

test("acknowledgeForm722: already acknowledged -> ALREADY_ACKNOWLEDGED, no duplicate event", async () => {
  const db = new FakeDb({ deal_events: [{ deal_id: "d1", kind: "form_722.acknowledged", created_at: new Date().toISOString() }] });
  const result = await acknowledgeForm722("d1", "b1", db as any, { acknowledgedByUserId: "u1" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "ALREADY_ACKNOWLEDGED");
  assert.equal(db.tables.deal_events.length, 1);
});
