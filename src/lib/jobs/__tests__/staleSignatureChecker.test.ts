import { test } from "node:test";
import assert from "node:assert/strict";
import { findStaleSignatures, writeStaleSignatureGaps } from "@/lib/jobs/staleSignatureChecker";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    return this;
  }
  lte(k: string, v: any) {
    this.filters.push({ t: "lte", k, v });
    return this;
  }
  insert(p: Row | Row[]) {
    const rows = Array.isArray(p) ? p : [p];
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...rows.map((r) => ({ id: `id-${Math.random().toString(36).slice(2, 8)}`, ...r })));
    return this;
  }
  then(resolve: any, reject?: any) {
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "lte") rows = rows.filter((r) => r[f.k] <= f.v);
    }
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { signed_documents: [], deal_gap_queue: [], ...seed };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

test("findStaleSignatures: expires within 14 days -> returned", async () => {
  const db = new FakeDb({
    signed_documents: [
      { deal_id: "d1", form_code: "FORM_1919", signer_ownership_entity_id: "o1", expires_at: isoDaysFromNow(10) },
    ],
  });
  const r = await findStaleSignatures(db as any);
  assert.equal(r.length, 1);
  assert.equal(r[0].days_remaining, 10);
});

test("findStaleSignatures: expires beyond 14 days -> not returned", async () => {
  const db = new FakeDb({
    signed_documents: [
      { deal_id: "d1", form_code: "FORM_1919", signer_ownership_entity_id: "o1", expires_at: isoDaysFromNow(60) },
    ],
  });
  const r = await findStaleSignatures(db as any);
  assert.equal(r.length, 0);
});

test("findStaleSignatures: already expired -> returned with negative days_remaining", async () => {
  const db = new FakeDb({
    signed_documents: [
      { deal_id: "d1", form_code: "FORM_413", signer_ownership_entity_id: "o1", expires_at: isoDaysFromNow(-5) },
    ],
  });
  const r = await findStaleSignatures(db as any);
  assert.equal(r.length, 1);
  assert.ok(r[0].days_remaining < 0);
});

test("findStaleSignatures: just signed (90 days out) -> not returned", async () => {
  const db = new FakeDb({
    signed_documents: [
      { deal_id: "d1", form_code: "FORM_1919", signer_ownership_entity_id: "o1", expires_at: isoDaysFromNow(90) },
    ],
  });
  const r = await findStaleSignatures(db as any);
  assert.equal(r.length, 0);
});

test("writeStaleSignatureGaps: inserts one deal_gap_queue row per finding", async () => {
  const db = new FakeDb();
  const n = await writeStaleSignatureGaps(db as any, [
    { deal_id: "d1", form_code: "FORM_1919", signer_id: "o1", expires_at: isoDaysFromNow(8), days_remaining: 8 },
  ]);
  assert.equal(n, 1);
  assert.equal(db.tables.deal_gap_queue.length, 1);
  assert.ok(db.tables.deal_gap_queue[0].description.includes("8 days"));
});
