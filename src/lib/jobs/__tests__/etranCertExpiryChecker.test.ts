import { test } from "node:test";
import assert from "node:assert/strict";
import { findExpiringEtranCredentials } from "@/lib/jobs/etranCertExpiryChecker";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: "lte" | "not_null"; k: string; v?: any }> = [];
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    return this;
  }
  not(k: string, op: string, v: any) {
    if (op === "is" && v === null) this.filters.push({ t: "not_null", k });
    return this;
  }
  lte(k: string, v: any) {
    this.filters.push({ t: "lte", k, v });
    return this;
  }
  then(resolve: any, reject?: any) {
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "not_null") rows = rows.filter((r) => r[f.k] !== null && r[f.k] !== undefined);
      else if (f.t === "lte") rows = rows.filter((r) => r[f.k] <= f.v);
    }
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { bank_etran_credentials: [], ...seed };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

test("findExpiringEtranCredentials: cert expiring within 30 days -> returned as expiring_soon", async () => {
  const db = new FakeDb({
    bank_etran_credentials: [{ bank_id: "b1", sba_lender_id: "LID-1", cert_expires_at: isoDaysFromNow(15) }],
  });
  const r = await findExpiringEtranCredentials(db as any);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "expiring_soon");
  assert.equal(r[0].days_remaining, 15);
});

test("findExpiringEtranCredentials: cert expiring beyond 30 days -> not returned", async () => {
  const db = new FakeDb({
    bank_etran_credentials: [{ bank_id: "b1", sba_lender_id: "LID-1", cert_expires_at: isoDaysFromNow(90) }],
  });
  const r = await findExpiringEtranCredentials(db as any);
  assert.equal(r.length, 0);
});

test("findExpiringEtranCredentials: already-expired cert -> returned as expired with negative days_remaining", async () => {
  const db = new FakeDb({
    bank_etran_credentials: [{ bank_id: "b1", sba_lender_id: "LID-1", cert_expires_at: isoDaysFromNow(-2) }],
  });
  const r = await findExpiringEtranCredentials(db as any);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "expired");
  assert.ok(r[0].days_remaining < 0);
});

test("findExpiringEtranCredentials: null cert_expires_at excluded", async () => {
  const db = new FakeDb({
    bank_etran_credentials: [{ bank_id: "b1", sba_lender_id: "LID-1", cert_expires_at: null }],
  });
  const r = await findExpiringEtranCredentials(db as any);
  assert.equal(r.length, 0);
});
