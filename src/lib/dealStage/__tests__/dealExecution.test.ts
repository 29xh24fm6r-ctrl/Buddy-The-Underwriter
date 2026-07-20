import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const stages = require("../stages") as typeof import("../stages");
const gates = require("../gates") as typeof import("../gates");
const transitions = require("../transitions") as typeof import("../transitions");
const queues = require("../queues") as typeof import("../queues");
const nextActions = require("../nextActions") as typeof import("../nextActions");

type Row = Record<string, any>;
let idCounter = 0;

class FakeDb {
  tables: Record<string, Row[]> = {
    deals: [],
    deal_brokerage_stage_transitions: [],
    brokerage_tasks: [],
    deal_checklist_items: [],
    deal_underwrite_guard_states: [],
    brokerage_closing_conditions: [],
    deal_next_actions: [],
    brokerage_closing_workflows: [],
  };
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const COLUMN_DEFAULTS: Record<string, any> = {
  status: "open",
  blocking: false,
  priority: "medium",
};

class FakeQuery {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  _update: Row | null = null;
  _insert: Row[] | null = null;
  _limit: number | null = null;
  _order: { key: string; asc: boolean } | null = null;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select() {
    return this;
  }
  order(key: string, opts?: { ascending?: boolean }) {
    this._order = { key, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this._limit = n;
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
  is(k: string, v: any) {
    this.filters.push({ t: "is", k, v });
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
  lte(k: string, v: any) {
    this.filters.push({ t: "lte", k, v });
    return this;
  }
  gte(k: string, v: any) {
    this.filters.push({ t: "gte", k, v });
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
    if (rows.length === 0) return Promise.resolve({ data: null, error: { message: "no rows" } });
    return Promise.resolve({ data: rows[0], error: null });
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
  // Real Supabase always hands back freshly-deserialized objects — a query
  // result is never the same JS reference as a row a later query mutates.
  // Copying here (not inside rows()/applyUpdate(), which must keep live
  // references to actually mutate the table) reproduces that.
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
      if (f.t === "neq" && val === f.v) return false;
      if (f.t === "is" && val !== f.v) return false;
      if (f.t === "in" && !(f.v as any[]).includes(val)) return false;
      if (f.t === "lt" && !(val != null && val < f.v)) return false;
      if (f.t === "lte" && !(val != null && val <= f.v)) return false;
      if (f.t === "gte" && !(val != null && val >= f.v)) return false;
    }
    return true;
  }
  private rows(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
    if (this._order) {
      const { key, asc } = this._order;
      rows = [...rows].sort((a, b) => (a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1));
    }
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return rows;
  }
}

const BANK_A = "bank-a";
const BANK_B = "bank-b";

function makeDeal(db: FakeDb, overrides: Row = {}): Row {
  const row = {
    id: `deal-${++idCounter}`,
    bank_id: BANK_A,
    name: "Test Deal",
    brokerage_stage: "intake",
    brokerage_stage_entered_at: new Date(0).toISOString(),
    brokerage_stage_owner_clerk_user_id: null,
    ...overrides,
  };
  db.tables.deals.push(row);
  return row;
}

// ---------------------------------------------------------------------
// Stage registry
// ---------------------------------------------------------------------

test("stage registry: 21 canonical stages, all valid", () => {
  assert.equal(stages.BROKERAGE_STAGES.length, 21);
  for (const s of stages.BROKERAGE_STAGES) {
    assert.equal(stages.isValidBrokerageStage(s), true);
  }
  assert.equal(stages.isValidBrokerageStage("not_a_stage"), false);
});

test("stage registry: terminal stages have no outbound transitions", () => {
  for (const terminal of ["post_close", "withdrawn", "declined", "lost"] as const) {
    assert.equal(stages.isTerminalStage(terminal), true);
    assert.equal(stages.ALLOWED_TRANSITIONS[terminal].length, 0);
  }
});

// ---------------------------------------------------------------------
// Transition matrix
// ---------------------------------------------------------------------

test("transition matrix: forward flow allowed, stage-skipping rejected", () => {
  assert.equal(stages.canTransition("intake", "discovery"), true);
  assert.equal(stages.canTransition("intake", "underwriting"), false, "cannot skip straight to underwriting");
});

test("transition matrix: on_hold can resume to any active stage", () => {
  assert.equal(stages.canTransition("on_hold", "packaging"), true);
  assert.equal(stages.canTransition("on_hold", "engagement"), true);
  assert.equal(stages.canTransition("on_hold", "on_hold"), false);
});

test("transitionDealStage rejects a transition outside the matrix", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "intake" });
  await assert.rejects(() =>
    transitions.transitionDealStage({ bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "underwriting" }, db as any),
  );
});

test("a deal cannot be marked withdrawn/declined/lost without a reason", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "intake" });
  await assert.rejects(() =>
    transitions.transitionDealStage({ bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "withdrawn" }, db as any),
  );
  const result = await transitions.transitionDealStage(
    { bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "withdrawn", reason: "borrower went elsewhere" },
    db as any,
  );
  assert.equal(result.deal.brokerage_stage, "withdrawn");
});

test("transitionDealStage writes an audit row with from/to/actor on every transition", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "intake" });
  await transitions.transitionDealStage({ bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "discovery" }, db as any);

  const audit = db.tables.deal_brokerage_stage_transitions[0];
  assert.equal(audit.from_stage, "intake");
  assert.equal(audit.to_stage, "discovery");
  assert.equal(audit.actor_clerk_user_id, "staff_1");
  assert.equal(audit.is_override, false);
});

test("tenant isolation: cannot transition another bank's deal", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { bank_id: BANK_A, brokerage_stage: "intake" });
  await assert.rejects(() =>
    transitions.transitionDealStage({ bankId: BANK_B, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "discovery" }, db as any),
  );
});

// ---------------------------------------------------------------------
// Entry and exit gates — read existing readiness signals, never write them
// ---------------------------------------------------------------------

test("gate: document_collection -> financial_analysis blocked by a missing required document", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "document_collection" });
  db.tables.deal_checklist_items.push({ id: "chk-1", deal_id: deal.id, title: "Tax returns", required: true, status: "missing" });

  const gate = await gates.checkStageGate("document_collection", "financial_analysis", deal.id, db as any);
  assert.equal(gate.canAdvance, false);
  assert.ok(gate.missingRequirements.some((m: string) => m.includes("Tax returns")));
});

test("gate: document_collection -> financial_analysis passes once documents are received", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "document_collection" });
  db.tables.deal_checklist_items.push({ id: "chk-1", deal_id: deal.id, title: "Tax returns", required: true, status: "received" });

  const gate = await gates.checkStageGate("document_collection", "financial_analysis", deal.id, db as any);
  assert.equal(gate.canAdvance, true);
});

test("gate: lender_strategy -> submitted blocked when underwrite guard is BLOCKED (spec's own worked example)", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "lender_strategy" });
  db.tables.deal_underwrite_guard_states.push({ deal_id: deal.id, severity: "BLOCKED" });

  const gate = await gates.checkStageGate("lender_strategy", "submitted", deal.id, db as any);
  assert.equal(gate.canAdvance, false);
});

test("gate: underwriting -> commitment requires guard severity READY, not just non-BLOCKED", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "underwriting" });
  db.tables.deal_underwrite_guard_states.push({ deal_id: deal.id, severity: "WARN" });

  const gate = await gates.checkStageGate("underwriting", "commitment", deal.id, db as any);
  assert.equal(gate.canAdvance, false);
});

test("gate: commitment -> closing blocked by an open closing condition", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "commitment" });
  db.tables.brokerage_closing_conditions.push({ id: "cond-1", deal_id: deal.id, title: "Insurance binder", status: "open" });

  const gate = await gates.checkStageGate("commitment", "closing", deal.id, db as any);
  assert.equal(gate.canAdvance, false);
  assert.ok(gate.missingRequirements.some((m: string) => m.includes("Insurance binder")));
});

test("gate: default gate blocks on an open blocking task and nothing else", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "engagement" });
  db.tables.brokerage_tasks.push({ id: "task-1", deal_id: deal.id, title: "Get signed engagement letter", blocking: true, status: "open" });

  const gate = await gates.checkStageGate("engagement", "application", deal.id, db as any);
  assert.equal(gate.canAdvance, false);
});

test("existing readiness systems remain authoritative: checking a gate never writes to deal_checklist_items, deal_underwrite_guard_states, or brokerage_closing_conditions", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "document_collection" });
  db.tables.deal_checklist_items.push({ id: "chk-1", deal_id: deal.id, title: "Tax returns", required: true, status: "missing" });
  db.tables.deal_underwrite_guard_states.push({ deal_id: deal.id, severity: "BLOCKED" });
  db.tables.brokerage_closing_conditions.push({ id: "cond-1", deal_id: deal.id, title: "Insurance binder", status: "open" });

  const before = JSON.stringify([db.tables.deal_checklist_items, db.tables.deal_underwrite_guard_states, db.tables.brokerage_closing_conditions]);
  await gates.checkStageGate("document_collection", "financial_analysis", deal.id, db as any);
  await gates.checkStageGate("lender_strategy", "submitted", deal.id, db as any);
  await gates.checkStageGate("commitment", "closing", deal.id, db as any);
  const after = JSON.stringify([db.tables.deal_checklist_items, db.tables.deal_underwrite_guard_states, db.tables.brokerage_closing_conditions]);

  assert.equal(before, after, "gate checks must be read-only against existing readiness tables");
});

test("transitionDealStage rejects a normal (non-override) transition when the gate fails", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "lender_strategy" });
  db.tables.deal_underwrite_guard_states.push({ deal_id: deal.id, severity: "BLOCKED" });

  await assert.rejects(() =>
    transitions.transitionDealStage({ bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "submitted" }, db as any),
  );
});

// ---------------------------------------------------------------------
// Override authorization (role check itself lives in the route; this
// verifies the domain-level override contract: reason required, missing
// requirements captured, audit trail marked).
// ---------------------------------------------------------------------

test("override bypasses the gate but still requires a reason and records what was missing", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "lender_strategy" });
  db.tables.deal_underwrite_guard_states.push({ deal_id: deal.id, severity: "BLOCKED" });

  await assert.rejects(() =>
    transitions.transitionDealStage({ bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "submitted", override: true }, db as any),
    /reason/i,
  );

  const result = await transitions.transitionDealStage(
    { bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "submitted", override: true, reason: "Lender agreed to proceed pending doc" },
    db as any,
  );
  assert.equal(result.wasOverride, true);
  assert.equal(result.deal.brokerage_stage, "submitted");

  const audit = db.tables.deal_brokerage_stage_transitions[0];
  assert.equal(audit.is_override, true);
  assert.ok(audit.missing_requirements.length > 0, "must capture what the gate said was missing at override time");
});

test("override still respects the stage matrix — cannot override to an unreachable stage", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "intake" });
  await assert.rejects(() =>
    transitions.transitionDealStage({ bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "closing", override: true, reason: "skip ahead" }, db as any),
  );
});

// ---------------------------------------------------------------------
// Existing document/financial systems remain authoritative (transitions
// never mutate them either — same invariant as gates, checked end-to-end)
// ---------------------------------------------------------------------

test("a successful stage transition does not touch deal_checklist_items, deal_underwrite_guard_states, or brokerage_closing_conditions", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "intake" });
  db.tables.deal_checklist_items.push({ id: "chk-1", deal_id: deal.id, title: "W2", required: false, status: "missing" });
  db.tables.deal_underwrite_guard_states.push({ deal_id: deal.id, severity: "READY" });

  const before = JSON.stringify([db.tables.deal_checklist_items, db.tables.deal_underwrite_guard_states]);
  await transitions.transitionDealStage({ bankId: BANK_A, dealId: deal.id, actorClerkUserId: "staff_1", toStage: "discovery" }, db as any);
  const after = JSON.stringify([db.tables.deal_checklist_items, db.tables.deal_underwrite_guard_states]);

  assert.equal(before, after);
});

// ---------------------------------------------------------------------
// Stage-age calculation
// ---------------------------------------------------------------------

test("stageAgeDays computes whole days since stage entry", () => {
  const enteredAt = new Date("2026-07-01T00:00:00Z");
  const now = new Date("2026-07-05T12:00:00Z");
  assert.equal(stages.stageAgeDays(enteredAt.toISOString(), now), 4);
});

// ---------------------------------------------------------------------
// Next-action determinism
// ---------------------------------------------------------------------

test("deriveBrokerageNextActions deterministically flags an overdue task", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "engagement" });
  db.tables.brokerage_tasks.push({
    id: "task-1", deal_id: deal.id, title: "Call borrower", status: "open", blocking: false,
    due_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  });

  const a1 = await nextActions.deriveBrokerageNextActions(BANK_A, deal.id, db as any);
  const a2 = await nextActions.deriveBrokerageNextActions(BANK_A, deal.id, db as any);

  assert.ok(a1.some((a: any) => a.sourceRule === "overdue_task"));
  assert.deepEqual(a1.map((a: any) => a.sourceRule).sort(), a2.map((a: any) => a.sourceRule).sort(), "same state must derive the same actions every time");
});

test("deriveBrokerageNextActions flags a deal with zero open tasks", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "engagement" });
  const actions = await nextActions.deriveBrokerageNextActions(BANK_A, deal.id, db as any);
  assert.ok(actions.some((a: any) => a.sourceRule === "missing_next_action"));
});

test("deriveBrokerageNextActions surfaces open deal_next_actions (existing underwrite-guard issues) without duplicating that system", async () => {
  const db = new FakeDb();
  const deal = makeDeal(db, { brokerage_stage: "underwriting" });
  db.tables.deal_next_actions.push({ id: "na-1", deal_id: deal.id, code: "UW_MISSING_AMOUNT", status: "open", title: "Missing loan amount" });

  const actions = await nextActions.deriveBrokerageNextActions(BANK_A, deal.id, db as any);
  assert.ok(actions.some((a: any) => a.sourceRule === "deal_next_actions:UW_MISSING_AMOUNT"));
});

// ---------------------------------------------------------------------
// Management queues — tenant isolation
// ---------------------------------------------------------------------

test("tenant isolation: stalled_deals queue never crosses banks", async () => {
  const db = new FakeDb();
  const staleCutoff = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
  makeDeal(db, { bank_id: BANK_A, brokerage_stage: "engagement", brokerage_stage_entered_at: staleCutoff });
  makeDeal(db, { bank_id: BANK_B, brokerage_stage: "engagement", brokerage_stage_entered_at: staleCutoff });

  const result = await queues.listManagementQueue({ bankId: BANK_A, queue: "stalled_deals" }, db as any);
  assert.equal(result.length, 1);
  assert.equal(result[0].bank_id, BANK_A);
});

// Regression: found live during SPEC-BROKERAGE-OPERATING-SYSTEM-V1 QA —
// these three cases queried deal_checklist_items / brokerage_closing_conditions
// / brokerage_closing_workflows with no bank_id scoping at all, returning
// every tenant's rows to whichever bank asked. A production symptom: the
// command center's "missing documents" panel showed ~200 items and several
// "Open deal" links 404'd, because most of what came back belonged to
// other tenants entirely.

test("tenant isolation: missing_documents queue never crosses banks", async () => {
  const db = new FakeDb();
  const dealA = makeDeal(db, { bank_id: BANK_A });
  const dealB = makeDeal(db, { bank_id: BANK_B });
  db.tables.deal_checklist_items.push(
    { id: "ci-1", bank_id: BANK_A, deal_id: dealA.id, title: "Personal Financial Statement", status: "missing", required: true },
    { id: "ci-2", bank_id: BANK_B, deal_id: dealB.id, title: "Rent roll", status: "missing", required: true },
  );

  const result = await queues.listManagementQueue({ bankId: BANK_A, queue: "missing_documents" }, db as any);
  assert.equal(result.length, 1, "must not return bank B's checklist items");
  assert.equal(result[0].deal_id, dealA.id);
});

test("tenant isolation: outstanding_conditions queue never crosses banks", async () => {
  const db = new FakeDb();
  const dealA = makeDeal(db, { bank_id: BANK_A });
  const dealB = makeDeal(db, { bank_id: BANK_B });
  db.tables.brokerage_closing_conditions.push(
    { id: "cc-1", deal_id: dealA.id, title: "Insurance binder", status: "open" },
    { id: "cc-2", deal_id: dealB.id, title: "Title commitment", status: "open" },
  );

  const result = await queues.listManagementQueue({ bankId: BANK_A, queue: "outstanding_conditions" }, db as any);
  assert.equal(result.length, 1, "must not return bank B's closing conditions");
  assert.equal(result[0].deal_id, dealA.id);
});

test("tenant isolation: closing_next_30_days queue never crosses banks", async () => {
  const db = new FakeDb();
  const dealA = makeDeal(db, { bank_id: BANK_A });
  const dealB = makeDeal(db, { bank_id: BANK_B });
  const soon = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  db.tables.brokerage_closing_workflows.push(
    { id: "wf-1", deal_id: dealA.id, target_close_date: soon, status: "in_progress" },
    { id: "wf-2", deal_id: dealB.id, target_close_date: soon, status: "in_progress" },
  );

  const result = await queues.listManagementQueue({ bankId: BANK_A, queue: "closing_next_30_days" }, db as any);
  assert.equal(result.length, 1, "must not return bank B's closing workflows");
  assert.equal(result[0].deal_id, dealA.id);
});

test("missing_documents / outstanding_conditions / closing_next_30_days queues return an empty list, not an error, for a bank with no deals", async () => {
  const db = new FakeDb();
  const results = await Promise.all([
    queues.listManagementQueue({ bankId: "bank-empty", queue: "missing_documents" }, db as any),
    queues.listManagementQueue({ bankId: "bank-empty", queue: "outstanding_conditions" }, db as any),
    queues.listManagementQueue({ bankId: "bank-empty", queue: "closing_next_30_days" }, db as any),
  ]);
  for (const r of results) assert.deepEqual(r, []);
});
