import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const engine = require("../engine") as typeof import("../engine");
const catalog = require("../catalog") as typeof import("../catalog");

type Row = Record<string, any>;
let idCounter = 0;

class FakeDb {
  tables: Record<string, Row[]> = {
    crm_sequence_enrollments: [],
    brokerage_leads: [],
    deals: [],
    brokerage_tasks: [],
    crm_activities: [],
    crm_message_templates: [],
  };
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const COLUMN_DEFAULTS: Record<string, any> = { status: "active", follow_up_required: false, active: true };

class FakeQuery {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  _update: Row | null = null;
  _insert: Row[] | null = null;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select() {
    return this;
  }
  order() {
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
  insert(payload: Row | Row[]) {
    // Simulate the DB's partial unique index on (sequence_key, entity_type, entity_id) where status='active'.
    const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
      id: r.id ?? `id-${++idCounter}`,
      status: "active",
      current_step: 0,
      enrolled_at: new Date(0).toISOString(),
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      ...r,
    }));
    if (this.table === "crm_sequence_enrollments") {
      for (const row of rows) {
        const conflict = (this.db.tables.crm_sequence_enrollments ?? []).find(
          (e) => e.status === "active" && e.sequence_key === row.sequence_key && e.entity_type === row.entity_type && e.entity_id === row.entity_id,
        );
        if (conflict) {
          this._insert = null;
          throw new Error(`duplicate key value violates unique constraint "idx_crm_sequence_enrollments_one_active"`);
        }
      }
    }
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...rows);
    this._insert = rows;
    return this;
  }
  update(patch: Row) {
    this._update = patch;
    return this;
  }
  single(): Promise<{ data: any; error: any }> {
    if (this._insert) return Promise.resolve({ data: { ...this._insert[0] }, error: null });
    if (this._update) {
      this.applyUpdate();
      const rows = this.rowsCopy();
      return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } });
    }
    const rows = this.rowsCopy();
    return rows.length ? Promise.resolve({ data: rows[0], error: null }) : Promise.resolve({ data: null, error: { message: "no rows" } });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._update) this.applyUpdate();
    return Promise.resolve({ data: this.rowsCopy()[0] ?? null, error: null });
  }
  then(onFulfilled: any, onRejected?: any) {
    if (this._insert) return Promise.resolve({ data: this._insert.map((r: Row) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
    if (this._update) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rowsCopy(), error: null }).then(onFulfilled, onRejected);
    }
    return Promise.resolve({ data: this.rowsCopy(), error: null }).then(onFulfilled, onRejected);
  }
  private rowsCopy(): Row[] {
    return this.rows().map((r) => ({ ...r }));
  }
  private applyUpdate() {
    for (const row of this.rows()) Object.assign(row, this._update);
  }
  private field(row: Row, key: string): any {
    return key in row ? row[key] : COLUMN_DEFAULTS[key];
  }
  private matches(row: Row): boolean {
    for (const f of this.filters) {
      const val = this.field(row, f.k);
      if (f.t === "eq" && val !== f.v) return false;
      if (f.t === "lte" && !(val != null && val <= f.v)) return false;
    }
    return true;
  }
  private rows(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
  }
}

const BANK_A = "bank-a";

function pastDue(): string {
  return new Date(Date.now() - 1000).toISOString();
}

// ---------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------

test("enrollInSequence rejects an entityType that doesn't match the sequence definition", async () => {
  const db = new FakeDb();
  await assert.rejects(() => engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "new_lead_follow_up", entityType: "deal", entityId: "deal-1" }, db as any));
});

test("cannot double-enroll the same entity in the same sequence while active (unique active constraint)", async () => {
  const db = new FakeDb();
  await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "new_lead_follow_up", entityType: "lead", entityId: "lead-1" }, db as any);
  await assert.rejects(() => engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "new_lead_follow_up", entityType: "lead", entityId: "lead-1" }, db as any));
});

// ---------------------------------------------------------------------
// Sequence stopping rules
// ---------------------------------------------------------------------

test("sequence stops when the lead converts", async () => {
  const db = new FakeDb();
  db.tables.brokerage_leads.push({ id: "lead-1", bank_id: BANK_A, status: "converted", do_not_contact: false, last_successful_contact_at: null });
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "new_lead_follow_up", entityType: "lead", entityId: "lead-1" }, db as any);
  db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!.next_step_due_at = pastDue();

  const result = await engine.advanceSequences(BANK_A, db as any);
  assert.equal(result.stopped, 1);
  const updated = db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!;
  assert.equal(updated.status, "stopped");
  assert.match(updated.stop_reason, /converted/);
});

test("sequence stops when the lead is disqualified", async () => {
  const db = new FakeDb();
  db.tables.brokerage_leads.push({ id: "lead-1", bank_id: BANK_A, status: "disqualified", do_not_contact: false, last_successful_contact_at: null });
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "unresponsive_lead", entityType: "lead", entityId: "lead-1" }, db as any);
  db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!.next_step_due_at = pastDue();

  const result = await engine.advanceSequences(BANK_A, db as any);
  assert.equal(result.stopped, 1);
});

test("sequence stops on do-not-contact even mid-run", async () => {
  const db = new FakeDb();
  db.tables.brokerage_leads.push({ id: "lead-1", bank_id: BANK_A, status: "new", do_not_contact: true, last_successful_contact_at: null });
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "new_lead_follow_up", entityType: "lead", entityId: "lead-1" }, db as any);
  db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!.next_step_due_at = pastDue();

  const result = await engine.advanceSequences(BANK_A, db as any);
  assert.equal(result.stopped, 1);
  assert.match(db.tables.crm_sequence_enrollments[0].stop_reason, /do_not_contact/);
});

test("sequence stops when the recipient responds after enrollment", async () => {
  const db = new FakeDb();
  db.tables.brokerage_leads.push({ id: "lead-1", bank_id: BANK_A, status: "new", do_not_contact: false, last_successful_contact_at: null });
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "new_lead_follow_up", entityType: "lead", entityId: "lead-1" }, db as any);

  // Recipient responds after enrollment.
  db.tables.brokerage_leads[0].last_successful_contact_at = new Date().toISOString();
  db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!.next_step_due_at = pastDue();

  const result = await engine.advanceSequences(BANK_A, db as any);
  assert.equal(result.stopped, 1);
  assert.match(db.tables.crm_sequence_enrollments[0].stop_reason, /responded/);
});

test("sequence stops when the deal reaches a terminal stage", async () => {
  const db = new FakeDb();
  db.tables.deals.push({ id: "deal-1", bank_id: BANK_A, brokerage_stage: "declined" });
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "missing_document_chase", entityType: "deal", entityId: "deal-1" }, db as any);
  db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!.next_step_due_at = pastDue();

  const result = await engine.advanceSequences(BANK_A, db as any);
  assert.equal(result.stopped, 1);
});

test("staff can manually stop an active sequence with a reason", async () => {
  const db = new FakeDb();
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "new_lead_follow_up", entityType: "lead", entityId: "lead-1" }, db as any);
  await engine.stopSequence({ bankId: BANK_A, enrollmentId: enrollment.id, reason: "Staff judgment call" }, db as any);

  const updated = db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!;
  assert.equal(updated.status, "stopped");
  assert.equal(updated.stop_reason, "Staff judgment call");
});

test("stopping an already-stopped enrollment is a no-op, not a second stop event", async () => {
  const db = new FakeDb();
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "new_lead_follow_up", entityType: "lead", entityId: "lead-1" }, db as any);
  await engine.stopSequence({ bankId: BANK_A, enrollmentId: enrollment.id, reason: "first reason" }, db as any);
  await engine.stopSequence({ bankId: BANK_A, enrollmentId: enrollment.id, reason: "second reason" }, db as any);

  assert.equal(db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!.stop_reason, "first reason", "first stop wins");
});

// ---------------------------------------------------------------------
// Advancement / no duplicate communications on retry
// ---------------------------------------------------------------------

test("advanceSequences fires the current step once, advances to the next step, and does not refire until that step is due", async () => {
  const db = new FakeDb();
  db.tables.deals.push({ id: "deal-1", bank_id: BANK_A, brokerage_stage: "document_collection" });
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "missing_document_chase", entityType: "deal", entityId: "deal-1" }, db as any);
  db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!.next_step_due_at = pastDue();

  const first = await engine.advanceSequences(BANK_A, db as any);
  assert.equal(first.advanced, 1);
  assert.equal(db.tables.brokerage_tasks.length, 1, "step 0 (queue_communication_for_approval) creates one review task");

  // Not due yet — a second call before the next step's due time must not refire.
  const second = await engine.advanceSequences(BANK_A, db as any);
  assert.equal(second.checked, 0);
  assert.equal(db.tables.brokerage_tasks.length, 1, "must not create a duplicate task on a call before the next step is due");
});

test("a sequence completes (status='completed') after its final step fires", async () => {
  const db = new FakeDb();
  db.tables.deals.push({ id: "deal-1", bank_id: BANK_A, brokerage_stage: "post_close" });
  const enrollment = await engine.enrollInSequence({ bankId: BANK_A, sequenceKey: "post_funding_referral_follow_up", entityType: "deal", entityId: "deal-1" }, db as any);

  const definition = catalog.getSequenceDefinition("post_funding_referral_follow_up")!;
  for (let i = 0; i < definition.steps.length; i++) {
    db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!.next_step_due_at = pastDue();
    await engine.advanceSequences(BANK_A, db as any);
  }

  const finalState = db.tables.crm_sequence_enrollments.find((e) => e.id === enrollment.id)!;
  assert.equal(finalState.status, "completed");
});
