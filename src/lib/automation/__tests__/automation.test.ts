import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const run = require("../run") as typeof import("../run");
const triggers = require("../triggers") as typeof import("../triggers");

type Row = Record<string, any>;
let idCounter = 0;

class FakeDb {
  tables: Record<string, Row[]> = {
    brokerage_leads: [],
    brokerage_tasks: [],
    deals: [],
    deal_checklist_items: [],
    brokerage_closing_conditions: [],
    crm_automation_executions: [],
    crm_person_organization_roles: [],
    crm_people: [],
  };
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const COLUMN_DEFAULTS: Record<string, any> = { status: "open", is_active: true, do_not_contact: false };

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
  limit() {
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
  lt(k: string, v: any) {
    this.filters.push({ t: "lt", k, v });
    return this;
  }
  insert(payload: Row | Row[]) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
      id: r.id ?? `id-${++idCounter}`,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      ...r,
    }));
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
    if (this._insert) return Promise.resolve({ data: this._insert.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
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
      if (f.t === "in" && !(f.v as any[]).includes(val)) return false;
      if (f.t === "lt" && !(val != null && val < f.v)) return false;
    }
    return true;
  }
  private rows(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
  }
}

const BANK_A = "bank-a";
const BANK_B = "bank-b";

function makeOverdueTask(db: FakeDb, bankId: string, dealId: string): Row {
  const row = { id: `task-${++idCounter}`, bank_id: bankId, deal_id: dealId, title: "Overdue thing", due_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), status: "open" };
  db.tables.brokerage_tasks.push(row);
  return row;
}

// ---------------------------------------------------------------------
// Automation idempotency / no duplicate on retry
// ---------------------------------------------------------------------

test("runAutomationTrigger creates exactly one execution per finding, and a retry is a pure no-op (already_exists)", async () => {
  const db = new FakeDb();
  const deal = { id: "deal-1", bank_id: BANK_A };
  db.tables.deals.push(deal);
  makeOverdueTask(db, BANK_A, deal.id);

  const first = await run.runAutomationTrigger(BANK_A, "task_overdue", db as any);
  assert.equal(first.found, 1);
  assert.equal(first.created, 1);
  assert.equal(first.alreadyExists, 0);

  const second = await run.runAutomationTrigger(BANK_A, "task_overdue", db as any);
  assert.equal(second.found, 1);
  assert.equal(second.created, 0, "a retry of the same trigger run must not fire the action twice");
  assert.equal(second.alreadyExists, 1);

  assert.equal(db.tables.crm_automation_executions.length, 1, "exactly one execution row, not one per run");
});

test("task_overdue fires once per distinct task, not once per trigger run", async () => {
  const db = new FakeDb();
  const deal = { id: "deal-1", bank_id: BANK_A };
  db.tables.deals.push(deal);
  makeOverdueTask(db, BANK_A, deal.id);
  makeOverdueTask(db, BANK_A, deal.id);

  const result = await run.runAutomationTrigger(BANK_A, "task_overdue", db as any);
  assert.equal(result.found, 2);
  assert.equal(result.created, 2);
});

// ---------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------

test("tenant isolation: task_overdue never crosses banks", async () => {
  const db = new FakeDb();
  db.tables.deals.push({ id: "deal-a", bank_id: BANK_A }, { id: "deal-b", bank_id: BANK_B });
  makeOverdueTask(db, BANK_A, "deal-a");
  makeOverdueTask(db, BANK_B, "deal-b");

  const result = await run.runAutomationTrigger(BANK_A, "task_overdue", db as any);
  assert.equal(result.found, 1);
});

test("tenant isolation: lead_stale never crosses banks", async () => {
  const db = new FakeDb();
  const staleCreatedAt = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  db.tables.brokerage_leads.push(
    { id: "lead-a", bank_id: BANK_A, status: "new", created_at: staleCreatedAt, last_attempted_contact_at: null, next_action_due_at: null, do_not_contact: false },
    { id: "lead-b", bank_id: BANK_B, status: "new", created_at: staleCreatedAt, last_attempted_contact_at: null, next_action_due_at: null, do_not_contact: false },
  );

  const findingsA = await triggers.findLeadStale(BANK_A, db as any);
  assert.equal(findingsA.length, 1);
  assert.equal(findingsA[0].entityId, "lead-a");
});

// ---------------------------------------------------------------------
// Do-not-contact behavior in trigger findings
// ---------------------------------------------------------------------

test("findLeadStale excludes do-not-contact leads even when otherwise stale", async () => {
  const db = new FakeDb();
  const staleCreatedAt = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  db.tables.brokerage_leads.push({ id: "lead-1", bank_id: BANK_A, status: "new", created_at: staleCreatedAt, last_attempted_contact_at: null, next_action_due_at: null, do_not_contact: true });

  const findings = await triggers.findLeadStale(BANK_A, db as any);
  assert.equal(findings.length, 0);
});

test("findReferralRelationshipStale excludes do-not-contact people", async () => {
  const db = new FakeDb();
  db.tables.crm_person_organization_roles.push({ person_id: "p1", bank_id: BANK_A, is_active: true });
  db.tables.crm_people.push({ id: "p1", bank_id: BANK_A, last_contacted_at: null, do_not_contact: true });

  const findings = await triggers.findReferralRelationshipStale(BANK_A, 60, db as any);
  assert.equal(findings.length, 0);
});

// ---------------------------------------------------------------------
// Failed action handling
// ---------------------------------------------------------------------

test("condition_overdue creates a task on the deal (create_task action) and is idempotent per condition", async () => {
  const db = new FakeDb();
  db.tables.deals.push({ id: "deal-1", bank_id: BANK_A });
  db.tables.brokerage_closing_conditions.push({ id: "cond-1", deal_id: "deal-1", title: "Insurance binder", status: "open", due_date: "2020-01-01" });

  const result = await run.runAutomationTrigger(BANK_A, "condition_overdue", db as any);
  assert.equal(result.created, 1);
  assert.equal(db.tables.brokerage_tasks.filter((t) => t.deal_id === "deal-1").length, 1);

  const retry = await run.runAutomationTrigger(BANK_A, "condition_overdue", db as any);
  assert.equal(retry.created, 0);
  assert.equal(db.tables.brokerage_tasks.filter((t) => t.deal_id === "deal-1").length, 1, "must not create a second task for the same overdue condition");
});
