import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const tasks = require("../tasks") as typeof import("../tasks");
const stagePlans = require("../stagePlans") as typeof import("../stagePlans");

type Row = Record<string, any>;
let idCounter = 0;

class FakeDb {
  tables: Record<string, Row[]> = { brokerage_tasks: [] };
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const COLUMN_DEFAULTS: Record<string, any> = { status: "open", blocking: false, priority: "medium" };

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
    }
    return true;
  }
  private rows(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
  }
}

const BANK_A = "bank-a";

test("createTask requires exactly one target", async () => {
  const db = new FakeDb();
  await assert.rejects(() =>
    tasks.createTask({ bankId: BANK_A, title: "No target", category: "other" }, db as any),
  );
  await assert.rejects(() =>
    tasks.createTask({ bankId: BANK_A, title: "Two targets", category: "other", dealId: "deal-1", leadId: "lead-1" }, db as any),
  );
});

test("updateTaskStatus to completed stamps completed_at/completed_by/outcome", async () => {
  const db = new FakeDb();
  const task = await tasks.createTask({ bankId: BANK_A, title: "Call borrower", category: "borrower_follow_up", dealId: "deal-1" }, db as any);
  const updated = await tasks.updateTaskStatus({ bankId: BANK_A, taskId: task.id, status: "completed", actorClerkUserId: "staff_1", completionOutcome: "Reached borrower" }, db as any);

  assert.equal(updated.status, "completed");
  assert.ok(updated.completed_at);
  assert.equal(updated.completed_by_clerk_user_id, "staff_1");
  assert.equal(updated.completion_outcome, "Reached borrower");
});

test("task dependency: depends_on_task_id is stored and readable", async () => {
  const db = new FakeDb();
  const first = await tasks.createTask({ bankId: BANK_A, title: "Collect docs", category: "document_request", dealId: "deal-1" }, db as any);
  const second = await tasks.createTask(
    { bankId: BANK_A, title: "Generate analysis", category: "financial_review", dealId: "deal-1", dependsOnTaskId: first.id },
    db as any,
  );
  assert.equal(second.depends_on_task_id, first.id);
});

// ---------------------------------------------------------------------
// Stage-generated task plans: idempotency
// ---------------------------------------------------------------------

test("generateStageTaskPlan creates each template once and skips already-open ones on a second call", async () => {
  const db = new FakeDb();
  const first = await stagePlans.generateStageTaskPlan(BANK_A, "deal-1", "document_collection", "staff_1", db as any);
  assert.equal(first.created.length, 1);
  assert.equal(first.skippedExisting.length, 0);

  const second = await stagePlans.generateStageTaskPlan(BANK_A, "deal-1", "document_collection", "staff_1", db as any);
  assert.equal(second.created.length, 0, "must not create a duplicate for a still-open auto-generated task");
  assert.equal(second.skippedExisting.length, 1);

  const dealTasks = db.tables.brokerage_tasks.filter((t) => t.deal_id === "deal-1");
  assert.equal(dealTasks.length, 1, "exactly one task must exist for this deal+stage+template");
});

test("generateStageTaskPlan regenerates a task once the prior one is completed (frees the automation_source)", async () => {
  const db = new FakeDb();
  const first = await stagePlans.generateStageTaskPlan(BANK_A, "deal-1", "qualification", "staff_1", db as any);
  assert.equal(first.created.length, 1);

  const createdTask = db.tables.brokerage_tasks.find((t) => t.deal_id === "deal-1");
  await tasks.updateTaskStatus({ bankId: BANK_A, taskId: createdTask!.id, status: "completed", actorClerkUserId: "staff_1" }, db as any);

  const second = await stagePlans.generateStageTaskPlan(BANK_A, "deal-1", "qualification", "staff_1", db as any);
  assert.equal(second.created.length, 1, "completing the prior task must free automation_source for a fresh cycle");
});

test("generateStageTaskPlan is a no-op for a stage with no defined template", async () => {
  const db = new FakeDb();
  // "intake" has no entry in STAGE_TASK_PLANS.
  const result = await stagePlans.generateStageTaskPlan(BANK_A, "deal-1", "intake" as any, "staff_1", db as any);
  assert.equal(result.created.length, 0);
  assert.equal(result.skippedExisting.length, 0);
});

test("tenant isolation: listTasksForDeal never crosses banks", async () => {
  const db = new FakeDb();
  await tasks.createTask({ bankId: "bank-a", title: "A's task", category: "other", dealId: "deal-shared" }, db as any);
  await tasks.createTask({ bankId: "bank-b", title: "B's task", category: "other", dealId: "deal-shared" }, db as any);

  const listA = await tasks.listTasksForDeal("bank-a", "deal-shared", db as any);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].bank_id, "bank-a");
});
