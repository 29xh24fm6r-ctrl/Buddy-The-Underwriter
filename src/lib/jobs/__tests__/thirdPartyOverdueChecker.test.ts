import { test } from "node:test";
import assert from "node:assert/strict";
import { findOverdueThirdPartyOrders, writeOverdueThirdPartyGaps } from "@/lib/jobs/thirdPartyOverdueChecker";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: "in" | "lt"; k: string; v: any }> = [];
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    return this;
  }
  in(k: string, v: any[]) {
    this.filters.push({ t: "in", k, v });
    return this;
  }
  lt(k: string, v: any) {
    this.filters.push({ t: "lt", k, v });
    return this;
  }
  upsert(p: Row | Row[], _opts?: { onConflict?: string }) {
    const rows = Array.isArray(p) ? p : [p];
    const conflictCols = (_opts?.onConflict ?? "").split(",").filter(Boolean);
    this.db.tables[this.table] ??= [];
    for (const r of rows) {
      const existing = conflictCols.length
        ? this.db.tables[this.table].find((existingRow) => conflictCols.every((c) => existingRow[c] === r[c]))
        : undefined;
      if (existing) Object.assign(existing, r);
      else this.db.tables[this.table].push({ id: `id-${Math.random().toString(36).slice(2, 8)}`, ...r });
    }
    return this;
  }
  then(resolve: any, reject?: any) {
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "in") rows = rows.filter((r) => (f.v as any[]).includes(r[f.k]));
      else if (f.t === "lt") rows = rows.filter((r) => r[f.k] < f.v);
    }
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { third_party_orders: [], deal_gap_queue: [], ...seed };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

test("findOverdueThirdPartyOrders: dispatched order past expected_completion_at -> returned", async () => {
  const db = new FakeDb({
    third_party_orders: [
      { id: "o1", deal_id: "d1", bank_id: "b1", order_type: "ucc_lien_search", status: "dispatched", expected_completion_at: isoDaysFromNow(-3) },
    ],
  });
  const r = await findOverdueThirdPartyOrders(db as any);
  assert.equal(r.length, 1);
  assert.equal(r[0].days_overdue, 3);
});

test("findOverdueThirdPartyOrders: in_progress order not yet due -> not returned", async () => {
  const db = new FakeDb({
    third_party_orders: [
      { id: "o1", deal_id: "d1", bank_id: "b1", order_type: "real_estate_appraisal", status: "in_progress", expected_completion_at: isoDaysFromNow(5) },
    ],
  });
  const r = await findOverdueThirdPartyOrders(db as any);
  assert.equal(r.length, 0);
});

test("findOverdueThirdPartyOrders: delivered/cancelled orders excluded even if past due", async () => {
  const db = new FakeDb({
    third_party_orders: [
      { id: "o1", deal_id: "d1", bank_id: "b1", order_type: "hazard_insurance", status: "delivered", expected_completion_at: isoDaysFromNow(-10) },
      { id: "o2", deal_id: "d1", bank_id: "b1", order_type: "title_commitment", status: "cancelled", expected_completion_at: isoDaysFromNow(-10) },
    ],
  });
  const r = await findOverdueThirdPartyOrders(db as any);
  assert.equal(r.length, 0);
});

test("findOverdueThirdPartyOrders: null expected_completion_at excluded (no SLA to be overdue against)", async () => {
  const db = new FakeDb({
    third_party_orders: [
      { id: "o1", deal_id: "d1", bank_id: "b1", order_type: "business_valuation", status: "dispatched", expected_completion_at: null },
    ],
  });
  const r = await findOverdueThirdPartyOrders(db as any);
  assert.equal(r.length, 0);
});

test("writeOverdueThirdPartyGaps: upserts one deal_gap_queue row per finding, with bank_id + fact_type set", async () => {
  const db = new FakeDb();
  const n = await writeOverdueThirdPartyGaps(db as any, [
    { order_id: "o1", deal_id: "d1", bank_id: "b1", order_type: "ucc_lien_search", status: "dispatched", expected_completion_at: isoDaysFromNow(-3), days_overdue: 3 },
  ]);
  assert.equal(n, 1);
  assert.equal(db.tables.deal_gap_queue.length, 1);
  assert.equal(db.tables.deal_gap_queue[0].bank_id, "b1");
  assert.equal(db.tables.deal_gap_queue[0].fact_type, "third_party_order");
  assert.ok(db.tables.deal_gap_queue[0].description.includes("3 days"));
});

test("writeOverdueThirdPartyGaps: re-running against the same still-overdue order updates the row instead of throwing a duplicate-key error", async () => {
  const db = new FakeDb();
  await writeOverdueThirdPartyGaps(db as any, [
    { order_id: "o1", deal_id: "d1", bank_id: "b1", order_type: "ucc_lien_search", status: "dispatched", expected_completion_at: isoDaysFromNow(-3), days_overdue: 3 },
  ]);
  await writeOverdueThirdPartyGaps(db as any, [
    { order_id: "o1", deal_id: "d1", bank_id: "b1", order_type: "ucc_lien_search", status: "dispatched", expected_completion_at: isoDaysFromNow(-4), days_overdue: 4 },
  ]);
  assert.equal(db.tables.deal_gap_queue.length, 1, "second run must update the existing row, not insert a duplicate");
  assert.ok(db.tables.deal_gap_queue[0].description.includes("4 days"));
});

test("writeOverdueThirdPartyGaps: priority escalates to 1 at 7+ days overdue", async () => {
  const db = new FakeDb();
  await writeOverdueThirdPartyGaps(db as any, [
    { order_id: "o1", deal_id: "d1", bank_id: "b1", order_type: "phase_1_environmental", status: "in_progress", expected_completion_at: isoDaysFromNow(-8), days_overdue: 8 },
  ]);
  assert.equal(db.tables.deal_gap_queue[0].priority, 1);
});
