import { test } from "node:test";
import assert from "node:assert/strict";
import { findDiscrepancies, reconcileTranscriptRequest } from "@/lib/integrations/irsTranscripts/reconciler";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ k: string; v: any }> = [];
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
    for (const f of this.filters) rows = rows.filter((r) => r[f.k] === f.v);
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { borrower_irs_transcript_requests: [], deal_financial_facts: [], deal_gap_queue: [], deal_events: [], ...seed };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

test("findDiscrepancies: matching AGI within threshold -> no discrepancy", () => {
  const result = findDiscrepancies(
    [{ tax_year: 2023, transcript_type: "return", fields: { agi: 100_500 } }],
    [{ fact_key: "agi", fact_value_num: 100_000, fact_period_end: "2023-12-31" }],
  );
  assert.equal(result.length, 0);
});

test("findDiscrepancies: AGI mismatch > $1,000 -> flagged", () => {
  const result = findDiscrepancies(
    [{ tax_year: 2023, transcript_type: "return", fields: { agi: 150_000 } }],
    [{ fact_key: "agi", fact_value_num: 100_000, fact_period_end: "2023-12-31" }],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].fact_key, "agi");
  assert.equal(result[0].abs_diff, 50_000);
});

test("findDiscrepancies: gross_receipts mismatch > $1,000 -> flagged", () => {
  const result = findDiscrepancies(
    [{ tax_year: 2024, transcript_type: "return", fields: { gross_receipts: 500_000 } }],
    [{ fact_key: "gross_receipts", fact_value_num: 480_000, fact_period_end: "2024-12-31" }],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].fact_key, "gross_receipts");
  assert.equal(result[0].tax_year, 2024);
});

test("findDiscrepancies: multi-year transcripts -> each year reconciled independently", () => {
  const result = findDiscrepancies(
    [
      { tax_year: 2022, transcript_type: "return", fields: { agi: 90_000 } },
      { tax_year: 2023, transcript_type: "return", fields: { agi: 200_000 } },
    ],
    [
      { fact_key: "agi", fact_value_num: 89_500, fact_period_end: "2022-12-31" },
      { fact_key: "agi", fact_value_num: 100_000, fact_period_end: "2023-12-31" },
    ],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].tax_year, 2023);
});

test("reconcileTranscriptRequest: end-to-end discrepancy -> deal_gap_queue row + status='reconciled'", async () => {
  const db = new FakeDb({
    borrower_irs_transcript_requests: [
      {
        id: "r1",
        deal_id: "d1",
        bank_id: "b1",
        ownership_entity_id: "o1",
        status: "received",
        reconciliation_summary: { transcripts: [{ tax_year: 2023, transcript_type: "return", fields: { agi: 150_000 } }] },
      },
    ],
    deal_financial_facts: [{ deal_id: "d1", fact_key: "agi", fact_value_num: 100_000, fact_period_end: "2023-12-31", is_superseded: false }],
  });
  const result = await reconcileTranscriptRequest("r1", { sb: db as any });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.discrepancyCount, 1);
  assert.equal(db.tables.borrower_irs_transcript_requests[0].status, "reconciled");
  assert.equal(db.tables.deal_gap_queue.length, 1);
  assert.equal(db.tables.deal_gap_queue[0].gap_type, "irs_transcript_discrepancy");
});
