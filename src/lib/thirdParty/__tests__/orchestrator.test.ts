import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAndCreateTriggers, dispatchOrder, ingestResult, cancelOrder, type EmailSender } from "@/lib/thirdParty/orchestrator";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: "eq" | "neq"; k: string; v: any }> = [];
  _u: Row | null = null;
  _i: Row[] | null = null;
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
    return this;
  }
  neq(k: string, v: any) {
    this.filters.push({ t: "neq", k, v });
    return this;
  }
  order(_k: string, _o?: any) {
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
  maybeSingle() {
    if (this._u) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
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
      else if (f.t === "neq") rows = rows.filter((r) => r[f.k] !== f.v);
    }
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  storage: any;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { third_party_orders: [], third_party_vendors: [], deal_events: [], ...seed };
    this.storage = { from: (_bucket: string) => ({ upload: async () => ({ error: null }) }) };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

const BASE_TRIGGER_INPUT = {
  loanAmount: 40_000, // below the $50K hazard-insurance threshold — keeps this a true "minimal" fixture (only ucc_lien_search fires)
  loanProgram: "sba_7a_standard",
  isAcquisition: false,
  isSingleOwnerBusiness: false,
  loanFullySecuredByHardCollateral: true,
  realEstateInUseOfProceeds: false,
  businessNaics: null,
};

test("evaluateAndCreateTriggers: creates third_party_orders rows scoped to deal + bank", async () => {
  const db = new FakeDb();
  const result = await evaluateAndCreateTriggers("d1", "b1", BASE_TRIGGER_INPUT, { sb: db as any });
  assert.equal(result.created, 1); // ucc_lien_search always fires
  assert.equal(db.tables.third_party_orders.length, 1);
  assert.equal(db.tables.third_party_orders[0].deal_id, "d1");
  assert.equal(db.tables.third_party_orders[0].bank_id, "b1");
  assert.equal(db.tables.third_party_orders[0].status, "triggered");
});

test("evaluateAndCreateTriggers: idempotent re-evaluation skips existing active order_type", async () => {
  const db = new FakeDb();
  await evaluateAndCreateTriggers("d1", "b1", BASE_TRIGGER_INPUT, { sb: db as any });
  const second = await evaluateAndCreateTriggers("d1", "b1", BASE_TRIGGER_INPUT, { sb: db as any });
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 1);
  assert.equal(db.tables.third_party_orders.length, 1);
});

test("dispatchOrder: moves status to dispatched, sends vendor email, writes deal_event", async () => {
  const db = new FakeDb({
    third_party_orders: [{ id: "o1", deal_id: "d1", order_type: "ucc_lien_search", status: "triggered" }],
    third_party_vendors: [{ id: "v1", legal_name: "Acme Title Co", contact_email: "vendor@example.com" }],
  });
  let sentTo: string | null = null;
  const email: EmailSender = { send: async (args) => { sentTo = args.to; return { provider: "test", provider_message_id: "m1" }; } };

  const result = await dispatchOrder(
    { orderId: "o1", vendorId: "v1", orderedByUserId: "u1" },
    { sb: db as any, email, emailFrom: "noreply@test.com", buildEmail: () => ({ subject: "s", body: "b" }) },
  );

  assert.equal(result.ok, true);
  assert.equal(sentTo, "vendor@example.com");
  assert.equal(db.tables.third_party_orders[0].status, "dispatched");
  assert.ok(db.tables.deal_events.some((e) => e.kind === "third_party.order_dispatched"));
});

test("ingestResult: uploads file, sets status='delivered' (or 'parsed' when resultParsedJson provided)", async () => {
  const db = new FakeDb({ third_party_orders: [{ id: "o1", deal_id: "d1", order_type: "real_estate_appraisal", status: "dispatched" }] });
  const result = await ingestResult({ orderId: "o1", fileBytes: Buffer.from("pdf"), fileName: "appraisal.pdf", contentType: "application/pdf", resultParsedJson: { value: 500_000 } }, { sb: db as any });
  assert.equal(result.ok, true);
  assert.equal(db.tables.third_party_orders[0].status, "parsed");
  assert.equal(db.tables.third_party_orders[0].result_parsed_json.value, 500_000);
});

test("cancelOrder: sets status='cancelled' with reason, writes deal_event", async () => {
  const db = new FakeDb({ third_party_orders: [{ id: "o1", deal_id: "d1", order_type: "hazard_insurance", status: "triggered" }] });
  const result = await cancelOrder({ orderId: "o1", reason: "Borrower already has coverage" }, { sb: db as any });
  assert.equal(result.ok, true);
  assert.equal(db.tables.third_party_orders[0].status, "cancelled");
  assert.equal(db.tables.third_party_orders[0].cancellation_reason, "Borrower already has coverage");
  assert.ok(db.tables.deal_events.some((e) => e.kind === "third_party.order_cancelled"));
});

test("evaluateAndCreateTriggers: rows for different deals never cross-contaminate (tenant isolation at the data-shape level)", async () => {
  const db = new FakeDb();
  await evaluateAndCreateTriggers("d1", "b1", BASE_TRIGGER_INPUT, { sb: db as any });
  await evaluateAndCreateTriggers("d2", "b2", BASE_TRIGGER_INPUT, { sb: db as any });
  const d1Orders = db.tables.third_party_orders.filter((o) => o.deal_id === "d1");
  const d2Orders = db.tables.third_party_orders.filter((o) => o.deal_id === "d2");
  assert.equal(d1Orders.length, 1);
  assert.equal(d2Orders.length, 1);
  assert.equal(d1Orders[0].bank_id, "b1");
  assert.equal(d2Orders[0].bank_id, "b2");
  // Real RLS enforcement (bank_user_memberships-scoped SELECT policy) is
  // verified at the Postgres layer by the applied migration, not here —
  // this confirms the orchestrator always writes the correct bank_id so
  // that policy has something correct to scope against.
});
