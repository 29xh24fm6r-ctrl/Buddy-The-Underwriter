import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const guardAutomation = require("../guardAutomation") as typeof import("../guardAutomation");

type Row = Record<string, any>;

/**
 * Regression test for a real production bug found during PR3 discovery:
 * deal_timeline_events was defined by two migrations with incompatible
 * shapes (kind/visible_to_borrower/created_by vs. visibility/event_type).
 * The second migration's CREATE TABLE IF NOT EXISTS silently no-opped
 * against the live table (confirmed via the live schema), so
 * applyGuardAutomation's writes — which used the never-applied
 * visibility/event_type shape — were failing on every call, uncaught,
 * since the insert's error wasn't checked. Every underwrite-guard-
 * transition timeline entry was silently lost.
 */
class FakeDb {
  tables: Record<string, Row[]> = {
    deal_underwrite_guard_states: [],
    deal_timeline_events: [],
    deal_next_actions: [],
    deal_message_drafts: [],
  };
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery {
  db: FakeDb;
  table: string;
  filters: Array<{ k: string; v: any }> = [];
  _insert: Row[] | null = null;
  _upsert: Row | null = null;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select() {
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ k, v });
    return this;
  }
  in(k: string, v: any[]) {
    this.filters.push({ k, v: { __in: v } });
    return this;
  }
  update(patch: Row) {
    for (const row of this.rows()) Object.assign(row, patch);
    return Promise.resolve({ data: null, error: null });
  }
  upsert(payload: Row) {
    this._upsert = payload;
    const existing = (this.db.tables[this.table] ?? []).find((r) => r.deal_id === payload.deal_id);
    if (existing) Object.assign(existing, payload);
    else this.db.tables[this.table].push({ id: `id-${Math.random()}`, ...payload });
    return Promise.resolve({ data: null, error: null });
  }
  insert(payload: Row | Row[]) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `id-${Math.random()}`, ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...rows);
    this._insert = rows;
    return this;
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(onFulfilled: any, onRejected?: any) {
    if (this._insert) return Promise.resolve({ data: this._insert, error: null }).then(onFulfilled, onRejected);
    return Promise.resolve({ data: this.rows(), error: null }).then(onFulfilled, onRejected);
  }
  private rows(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => (f.v && typeof f.v === "object" && "__in" in f.v ? f.v.__in.includes(r[f.k]) : r[f.k] === f.v)),
    );
  }
}

test("applyGuardAutomation writes deal_timeline_events using the real live column shape (kind/visible_to_borrower), not the never-applied visibility/event_type shape", async () => {
  const db = new FakeDb();
  await guardAutomation.applyGuardAutomation(
    {
      bankerUserId: "staff_1",
      guard: {
        dealId: "deal-1",
        severity: "BLOCKED",
        issues: [{ code: "UW_MISSING_AMOUNT", severity: "BLOCKED", title: "Missing amount", detail: "...", fix: { label: "Add amount", target: { kind: "deal_cockpit", dealId: "deal-1" } } }],
        stats: { blockedCount: 1, warnCount: 0 },
      },
    },
    db as any,
  );

  const events = db.tables.deal_timeline_events;
  assert.equal(events.length, 2, "must write both the banker and borrower timeline events");
  for (const e of events) {
    assert.ok("kind" in e, "must use the real 'kind' column, not 'event_type'");
    assert.ok(typeof e.visible_to_borrower === "boolean", "must use the real 'visible_to_borrower' boolean column, not a 'visibility' string");
    assert.equal("visibility" in e, false, "must not write the non-existent 'visibility' column");
    assert.equal("event_type" in e, false, "must not write the non-existent 'event_type' column");
  }
  assert.equal(events.find((e: Row) => e.visible_to_borrower === false)?.kind, "underwrite_guard_transition");
  assert.equal(events.find((e: Row) => e.visible_to_borrower === true)?.kind, "underwrite_status_updated");
});

test("applyGuardAutomation is a no-op on the second call with unchanged severity (idempotent, no duplicate timeline spam)", async () => {
  const db = new FakeDb();
  const guard = {
    dealId: "deal-2",
    severity: "READY" as const,
    issues: [],
    stats: { blockedCount: 0, warnCount: 0 },
  };
  await guardAutomation.applyGuardAutomation({ bankerUserId: "staff_1", guard }, db as any);
  await guardAutomation.applyGuardAutomation({ bankerUserId: "staff_1", guard }, db as any);

  assert.equal(db.tables.deal_timeline_events.length, 2, "second identical call must not write more timeline events");
});
