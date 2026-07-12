import { test } from "node:test";
import assert from "node:assert/strict";
import { requestSoftPull, type CreditBureauVendorClient } from "@/lib/integrations/creditBureau/request";

/**
 * SPEC S4 B-3 — integration test for the soft-pull happy path: connect
 * Plaid (out of scope here, assumed already done per S2) -> request soft
 * pull -> tradelines persisted -> abnormality (mock charge-off) detected ->
 * deal_gap_queue row created.
 */

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  _u: Row | null = null;
  _i: Row[] | null = null;
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    return this;
  }
  order(_k: string, _o?: any) {
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
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
  update(u: Row) {
    this._u = u;
    return this;
  }
  single(): Promise<{ data: any; error: any }> {
    if (this._i) return Promise.resolve({ data: this._i[0], error: null });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._u) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rows()[0], error: null });
    }
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve: any, reject?: any) {
    if (this._u) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
    }
    if (this._i) return Promise.resolve({ data: this._i, error: null }).then(resolve, reject);
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
  private applyUpdate() {
    for (const r of this.rows()) Object.assign(r, this._u);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter((r) => r[f.k] === f.v);
    }
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  storage: any;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = {
      borrower_credit_pulls: [],
      borrower_credit_tradelines: [],
      deal_gap_queue: [],
      deal_events: [],
      ...seed,
    };
    this.storage = { from: (_bucket: string) => ({ upload: async () => ({ error: null }) }) };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

test("full soft-pull happy path: charge-off tradeline -> gap created", async () => {
  const db = new FakeDb();

  const vendor: CreditBureauVendorClient = {
    currentVendor: () => "plaid_check",
    requestVendorSoftPull: async () => ({
      request_id: "req_123",
      status: "completed",
      bureau: "TU",
      report: {
        fico_score: 690,
        tradelines: [
          { account_type: "credit_card", creditor_name: "Chase", current_balance: 4000, status: "charge_off" },
          { account_type: "auto_loan", creditor_name: "Ally", current_balance: 8000, status: "open", payment_history_24mo: "111111111111111111111111" },
        ],
        public_records: [],
        inquiries_24mo: [],
      },
    }),
  };

  const result = await requestSoftPull(
    {
      dealId: "d1",
      bankId: "b1",
      ownershipEntityId: "o1",
      taxIdLast4: "1234",
      dateOfBirth: "1980-01-01",
      firstName: "Jane",
      lastName: "Doe",
      address: { line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" },
      consentVersion: "v1.0",
      consentTextHash: "hash123",
      consentAt: new Date().toISOString(),
    },
    { sb: db as any, vendor },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "completed");
  assert.equal(result.reused, false);
  assert.equal(result.abnormalityCount, 1);

  assert.equal(db.tables.borrower_credit_pulls.length, 1);
  assert.equal(db.tables.borrower_credit_pulls[0].pull_type, "soft");
  assert.equal(db.tables.borrower_credit_pulls[0].status, "completed");

  assert.equal(db.tables.borrower_credit_tradelines.length, 2);

  assert.equal(db.tables.deal_gap_queue.length, 1);
  assert.equal(db.tables.deal_gap_queue[0].gap_type, "credit_explanation");
  assert.ok(db.tables.deal_gap_queue[0].description.includes("Chase"));

  assert.ok(db.tables.deal_events.some((e) => e.kind === "credit_pull.completed"));

  // Re-request same day for same owner/vendor -> idempotent reuse, no duplicate insert
  const second = await requestSoftPull(
    {
      dealId: "d1",
      bankId: "b1",
      ownershipEntityId: "o1",
      taxIdLast4: "1234",
      dateOfBirth: "1980-01-01",
      firstName: "Jane",
      lastName: "Doe",
      address: { line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" },
      consentVersion: "v1.0",
      consentTextHash: "hash123",
      consentAt: new Date().toISOString(),
    },
    { sb: db as any, vendor },
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.reused, true);
  assert.equal(db.tables.borrower_credit_pulls.length, 1);
});

test("missing consent -> MISSING_CONSENT, no DB writes", async () => {
  const db = new FakeDb();
  const vendor: CreditBureauVendorClient = {
    currentVendor: () => "plaid_check",
    requestVendorSoftPull: async () => ({ request_id: "req_x", status: "completed", report: { tradelines: [] } }),
  };

  const result = await requestSoftPull(
    {
      dealId: "d1",
      bankId: "b1",
      ownershipEntityId: "o1",
      taxIdLast4: "1234",
      dateOfBirth: "1980-01-01",
      firstName: "Jane",
      lastName: "Doe",
      address: { line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" },
      consentVersion: "",
      consentTextHash: "",
      consentAt: "",
    },
    { sb: db as any, vendor },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "MISSING_CONSENT");
  assert.equal(db.tables.borrower_credit_pulls.length, 0);
});
