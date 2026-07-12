import { test } from "node:test";
import assert from "node:assert/strict";
import { pollPendingTranscripts, computeNextPollAt, type IrsPollingVendorClient } from "@/lib/integrations/irsTranscripts/polling";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: "eq" | "lte"; k: string; v: any }> = [];
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
  lte(k: string, v: any) {
    this.filters.push({ t: "lte", k, v });
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
      else if (f.t === "lte") rows = rows.filter((r) => r[f.k] != null && r[f.k] <= f.v);
    }
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { borrower_irs_transcript_requests: [], deal_gap_queue: [], ...seed };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

function isoHoursFromNow(hours: number, base = Date.now()): string {
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}
function isoDaysFromNow(days: number, base = Date.now()): string {
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

test("computeNextPollAt: within first 48h -> next poll in 4h", () => {
  const now = new Date();
  const submittedAt = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1h ago
  const result = computeNextPollAt(submittedAt, now);
  assert.equal(result.expired, false);
  const hoursAhead = (new Date(result.nextPollAt!).getTime() - now.getTime()) / (60 * 60 * 1000);
  assert.ok(Math.abs(hoursAhead - 4) < 0.01);
});

test("computeNextPollAt: 48h-7d window -> next poll in 24h", () => {
  const now = new Date();
  const submittedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
  const result = computeNextPollAt(submittedAt, now);
  assert.equal(result.expired, false);
  const hoursAhead = (new Date(result.nextPollAt!).getTime() - now.getTime()) / (60 * 60 * 1000);
  assert.ok(Math.abs(hoursAhead - 24) < 0.01);
});

test("computeNextPollAt: beyond 14 days -> expired=true, nextPollAt=null", () => {
  const now = new Date();
  const submittedAt = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  const result = computeNextPollAt(submittedAt, now);
  assert.equal(result.expired, true);
  assert.equal(result.nextPollAt, null);
});

test("pollPendingTranscripts: received -> status='received', reconciliation_summary populated", async () => {
  const now = new Date();
  const db = new FakeDb({
    borrower_irs_transcript_requests: [
      { id: "r1", deal_id: "d1", bank_id: "b1", vendor_request_id: "vr1", submitted_at: isoDaysFromNow(-1, now.getTime()), next_poll_at: isoHoursFromNow(-1, now.getTime()), poll_attempt_count: 1, status: "submitted" },
    ],
  });
  const vendor: IrsPollingVendorClient = {
    pollVendorTranscriptRequest: async () => ({ status: "completed", transcripts: [{ tax_year: 2023, transcript_type: "return", fields: { agi: 100_000 } }] }),
  };
  const outcomes = await pollPendingTranscripts({ sb: db as any, vendor }, now);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].outcome, "received");
  assert.equal(db.tables.borrower_irs_transcript_requests[0].status, "received");
  assert.equal(db.tables.borrower_irs_transcript_requests[0].reconciliation_summary.transcripts.length, 1);
});

test("pollPendingTranscripts: row not yet due (next_poll_at in future) -> skipped", async () => {
  const now = new Date();
  const db = new FakeDb({
    borrower_irs_transcript_requests: [
      { id: "r1", deal_id: "d1", bank_id: "b1", vendor_request_id: "vr1", submitted_at: isoDaysFromNow(-1, now.getTime()), next_poll_at: isoHoursFromNow(2, now.getTime()), poll_attempt_count: 0, status: "submitted" },
    ],
  });
  let called = false;
  const vendor: IrsPollingVendorClient = { pollVendorTranscriptRequest: async () => { called = true; return { status: "pending" }; } };
  const outcomes = await pollPendingTranscripts({ sb: db as any, vendor }, now);
  assert.equal(outcomes.length, 0);
  assert.equal(called, false);
});
