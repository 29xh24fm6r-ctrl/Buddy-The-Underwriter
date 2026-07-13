import { test } from "node:test";
import assert from "node:assert/strict";
import { runCaivrsCheck, CaivrsCredentialsMissingError, type CaivrsVendorClient } from "@/lib/integrations/caivrs/service";

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
  insert(p: Row | Row[]) {
    const rows = Array.isArray(p) ? p : [p];
    const withIds = rows.map((r) => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...withIds);
    this._i = withIds;
    return this;
  }
  single() {
    return Promise.resolve({ data: this._i ? this._i[0] : this.rows()[0] ?? null, error: null });
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
  constructor() {
    this.tables = { borrower_caivrs_checks: [], deal_gap_queue: [], deal_events: [] };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

const BASE_ARGS = {
  dealId: "d1",
  bankId: "b1",
  ownershipEntityId: "o1",
  ssnFull: "123456789",
  consentVersion: "v1.0",
  consentTextHash: "hash",
  consentAt: new Date().toISOString(),
};

test("runCaivrsCheck: clear result -> status='clear', no gap row", async () => {
  const db = new FakeDb();
  const vendor: CaivrsVendorClient = { runCaivrsVendorCheck: async () => ({ authorization_number: "AUTH1", hits: [] }) };
  const result = await runCaivrsCheck(BASE_ARGS, { sb: db as any, vendor });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "clear");
  assert.equal(result.hitCount, 0);
  assert.equal(db.tables.deal_gap_queue.length, 0);
});

test("runCaivrsCheck: hit result -> status='hit', gap row created with priority 1", async () => {
  const db = new FakeDb();
  const vendor: CaivrsVendorClient = {
    runCaivrsVendorCheck: async () => ({ authorization_number: "AUTH2", hits: [{ case_number: "C1", program: "504" }] }),
  };
  const result = await runCaivrsCheck(BASE_ARGS, { sb: db as any, vendor });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "hit");
  assert.equal(result.hitCount, 1);
  assert.equal(db.tables.deal_gap_queue.length, 1);
  assert.equal(db.tables.deal_gap_queue[0].priority, 1);
});

test("runCaivrsCheck: credentials missing -> CAIVRS_CREDENTIALS_MISSING, gap surfaced to banker", async () => {
  const db = new FakeDb();
  const vendor: CaivrsVendorClient = {
    runCaivrsVendorCheck: async () => {
      throw new CaivrsCredentialsMissingError();
    },
  };
  const result = await runCaivrsCheck(BASE_ARGS, { sb: db as any, vendor });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "CAIVRS_CREDENTIALS_MISSING");
  assert.equal(db.tables.deal_gap_queue.length, 1);
  assert.equal(db.tables.deal_gap_queue[0].gap_type, "caivrs_not_run");
});

test("runCaivrsCheck: same deal/owner/day re-run -> idempotent reuse, vendor not called twice", async () => {
  const db = new FakeDb();
  let callCount = 0;
  const vendor: CaivrsVendorClient = {
    runCaivrsVendorCheck: async () => {
      callCount++;
      return { authorization_number: "AUTH3", hits: [] };
    },
  };
  const first = await runCaivrsCheck(BASE_ARGS, { sb: db as any, vendor });
  const second = await runCaivrsCheck(BASE_ARGS, { sb: db as any, vendor });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.reused, true);
  assert.equal(callCount, 1);
  assert.equal(db.tables.borrower_caivrs_checks.length, 1);
});
