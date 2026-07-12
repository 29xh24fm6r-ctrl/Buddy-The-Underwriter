import { test } from "node:test";
import assert from "node:assert/strict";
import { initiateKyc, handlePersonaWebhook, hasValidIal2, type PersonaClient } from "@/lib/identity/kyc/service";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  _u: Row | null = null;
  _i: Row[] | null = null;
  _l: number | null = null;
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
  limit(n: number) {
    this._l = n;
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
    return this;
  }
  in(k: string, v: any[]) {
    this.filters.push({ t: "in", k, v });
    return this;
  }
  not(k: string, _op: string, v: any) {
    this.filters.push({ t: "not_null", k, v });
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
      else if (f.t === "in") rows = rows.filter((r) => (f.v as any[]).includes(r[f.k]));
      else if (f.t === "not_null") rows = rows.filter((r) => r[f.k] != null);
    }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = {
      borrower_identity_verifications: [],
      ownership_entities: [],
      deal_events: [],
      ...seed,
    };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

function fakePersona(overrides?: Partial<PersonaClient>): PersonaClient {
  let createCallCount = 0;
  return {
    createPersonaInquiry: async () => {
      createCallCount++;
      return { data: { id: `inq_${createCallCount}` } };
    },
    fetchPersonaInquiry: async (id: string) => ({
      data: { id, attributes: { status: "completed", "name-first": "Jane", "name-last": "Doe" } },
    }),
    generatePersonaOneTimeLink: async () => "https://withpersona.com/verify/otl_abc",
    ...overrides,
  };
}

test("initiateKyc: no existing -> creates new + writes deal_event", async () => {
  const db = new FakeDb({ ownership_entities: [{ id: "o1", display_name: "Jane Doe" }] });
  const persona = fakePersona();
  const r = await initiateKyc(
    { dealId: "d1", bankId: "b1", ownershipEntityId: "o1", initiatorUserId: "u1" },
    { sb: db as any, persona, templateId: "itmpl_1" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reused, false);
    assert.equal(db.tables.borrower_identity_verifications.length, 1);
    assert.ok(db.tables.deal_events.some((e) => e.kind === "kyc.verification_initiated"));
  }
});

test("initiateKyc: existing pending -> reuses, no new inquiry created", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", status: "pending", vendor_inquiry_id: "inq_existing", created_at: "2026-01-01" },
    ],
    ownership_entities: [{ id: "o1", display_name: "Jane Doe" }],
  });
  let createCalled = false;
  const persona = fakePersona({ createPersonaInquiry: async () => { createCalled = true; return { data: { id: "inq_new" } }; } });
  const r = await initiateKyc(
    { dealId: "d1", bankId: "b1", ownershipEntityId: "o1", initiatorUserId: "u1" },
    { sb: db as any, persona, templateId: "itmpl_1" },
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.reused, true);
  assert.equal(createCalled, false);
  assert.equal(db.tables.borrower_identity_verifications.length, 1);
});

test("initiateKyc: missing owner -> OWNER_NOT_FOUND", async () => {
  const db = new FakeDb();
  const persona = fakePersona();
  const r = await initiateKyc(
    { dealId: "d1", bankId: "b1", ownershipEntityId: "o-missing", initiatorUserId: "u1" },
    { sb: db as any, persona, templateId: "itmpl_1" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "OWNER_NOT_FOUND");
});

test("handlePersonaWebhook: status=completed -> updates record, sets completed_at", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [{ id: "v1", deal_id: "d1", vendor_inquiry_id: "inq_1", status: "pending" }],
  });
  const persona = fakePersona({
    fetchPersonaInquiry: async (id) => ({ data: { id, attributes: { status: "completed", "name-first": "Jane", "name-last": "Doe" } } }),
  });
  const r = await handlePersonaWebhook({ data: { id: "inq_1" } }, { sb: db as any, persona });
  assert.equal(r.ok, true);
  const rec = db.tables.borrower_identity_verifications[0];
  assert.equal(rec.status, "completed");
  assert.ok(rec.completed_at);
});

test("handlePersonaWebhook: status=declined -> updates record, no completed_at", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [{ id: "v1", deal_id: "d1", vendor_inquiry_id: "inq_1", status: "pending" }],
  });
  const persona = fakePersona({
    fetchPersonaInquiry: async (id) => ({ data: { id, attributes: { status: "declined" } } }),
  });
  const r = await handlePersonaWebhook({ data: { id: "inq_1" } }, { sb: db as any, persona });
  assert.equal(r.ok, true);
  const rec = db.tables.borrower_identity_verifications[0];
  assert.equal(rec.status, "declined");
  assert.equal(rec.completed_at, undefined);
});

test("handlePersonaWebhook: missing inquiry_id -> MISSING_INQUIRY_ID", async () => {
  const db = new FakeDb();
  const persona = fakePersona();
  const r = await handlePersonaWebhook({}, { sb: db as any, persona });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "MISSING_INQUIRY_ID");
});

test("hasValidIal2: completed + completed_at set -> true", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", status: "completed", completed_at: "2026-01-01" },
    ],
  });
  const r = await hasValidIal2("d1", "o1", db as any);
  assert.equal(r, true);
});

test("hasValidIal2: only pending -> false", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", status: "pending", completed_at: null },
    ],
  });
  const r = await hasValidIal2("d1", "o1", db as any);
  assert.equal(r, false);
});

test("hasValidIal2: declined -> false", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", status: "declined", completed_at: null },
    ],
  });
  const r = await hasValidIal2("d1", "o1", db as any);
  assert.equal(r, false);
});
