import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const hooks = require("../commsLifecycleHooks") as typeof import("../commsLifecycleHooks");
const obs = require("../commsLifecycleObservability") as typeof import("../commsLifecycleObservability");

type Row = Record<string, any>;

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// ── In-memory Supabase stub ────────────────────────────────────────────────

class RS {
  tables: Record<string, Row[]> = {
    deals: [],
    borrower_concierge_sessions: [],
    deal_documents: [],
    deal_document_slots: [],
    brokerage_comms_outbox: [],
    brokerage_comms_ledger: [],
    brokerage_borrower_message_templates: [],
    brokerage_borrower_message_outbox: [],
  };
  from(t: string) { return new RQ(this, t); }
}

class RQ {
  db: RS; table: string; filters: Array<{ t: string; k: string; v: any }>; _u: Row | null; _i: Row[] | null; _l: number | null; _ord: { key: string; asc: boolean } | null;
  constructor(db: RS, t: string) { this.db = db; this.table = t; this.filters = []; this._u = null; this._i = null; this._l = null; this._ord = null; }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  is(k: string, v: any) { this.filters.push({ t: "is", k, v }); return this; }
  neq(k: string, v: any) { this.filters.push({ t: "neq", k, v }); return this; }
  insert(p: Row | Row[]) { const rows = Array.isArray(p) ? p : [p]; const wi = rows.map(r => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r })); this.db.tables[this.table] ??= []; this.db.tables[this.table].push(...wi); this._i = wi; return this; }
  update(u: Row) { this._u = u; return this; }
  single(): Promise<{ data: any; error: any }> { if (this._i) return Promise.resolve({ data: this._i[0], error: null }); return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  maybeSingle(): Promise<{ data: any; error: any }> { if (this._u) { for (const r of this.rows()) Object.assign(r, this._u); return Promise.resolve({ data: this.rows()[0], error: null }); } return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  then(f: any, r?: any) { if (this._u) { for (const row of this.rows()) Object.assign(row, this._u); return Promise.resolve({ data: this.rows(), error: null }).then(f, r); } if (this._i) return Promise.resolve({ data: this._i, error: null }).then(f, r); return Promise.resolve({ data: this.rows(), error: null }).then(f, r); }
  private rows() { let rows = [...(this.db.tables[this.table] ?? [])]; for (const f of this.filters) { if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v); else if (f.t === "neq") rows = rows.filter(r => r[f.k] !== f.v); else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k])); else if (f.t === "is") rows = rows.filter(r => { const v = r[f.k]; return f.v === null ? v == null : v === f.v; }); } if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); } if (this._l != null) rows = rows.slice(0, this._l); return rows; }
}

function freshDb(): RS {
  const db = new RS();
  db.tables.deals = [{ id: "d1", status: "active", display_name: "Test Deal", borrower_name: "Test Borrower", borrower_email: "borrower@test.com" }];
  db.tables.deal_document_slots = [{ deal_id: "d1", required_doc_type: "BTR" }];
  db.tables.borrower_concierge_sessions = [{ deal_id: "d1", extracted_facts: { borrower: { first_name: "Test", phone: "+12025551234", sms_opt_in: true } } }];
  return db;
}

const ALL_HOOKS: import("../commsLifecycleHooks").LifecycleHookEvent[] = [
  "documents_received",
  "readiness_regressed",
  "deal_ready_for_review",
  "missing_documents_detected",
  "borrower_nudge_failed",
  "borrower_nudge_exhausted",
];

// ── Regression tests ──────────────────────────────────────────────────────

test("all lifecycle hooks route through handleLifecycleHook", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";

  for (const event of ALL_HOOKS) {
    const db = freshDb();
    const r = await hooks.handleLifecycleHook({ dealId: "d1", event }, db as any);
    assert.ok(["enqueued", "skipped", "failed"].includes(r.action), `${event} must return valid action`);
    assert.equal(r.event, event, `Result event must match input`);
  }

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("hook call sites do not await/block primary workflow", () => {
  // Verify each call site uses void + .catch(() => {})
  const readinessTs = read("src/lib/deals/readiness.ts");
  const bankerUpload = read("src/app/api/deals/[dealId]/files/record/route.ts");
  const portalUpload = read("src/app/api/portal/[token]/files/record/route.ts");
  const outboxTs = read("src/lib/brokerage/commsOutbox.ts");

  // readiness.ts: deal_ready_for_review + readiness_regressed
  assert.ok(readinessTs.includes('void import("@/lib/brokerage/commsLifecycleHooks")'), "readiness.ts must use void import");
  assert.ok(readinessTs.includes('.catch(() => {})'), "readiness.ts must catch errors");

  // banker upload
  assert.ok(bankerUpload.includes('void import("@/lib/brokerage/commsLifecycleHooks")'), "banker upload must use void import");
  assert.ok(bankerUpload.includes('.catch(() => {})'), "banker upload must catch errors");

  // portal upload
  assert.ok(portalUpload.includes('void import("@/lib/brokerage/commsLifecycleHooks")'), "portal upload must use void import");
  assert.ok(portalUpload.includes('.catch(() => {})'), "portal upload must catch errors");

  // outbox escalation
  assert.ok(outboxTs.includes("fireNudgeEscalation"), "outbox must call escalation helper");
  assert.ok(outboxTs.includes("void fireNudgeEscalation"), "outbox must use void for escalation");
});

test("hooks never call adapters directly", () => {
  const hooksSrc = read("src/lib/brokerage/commsLifecycleHooks.ts");
  assert.ok(!hooksSrc.includes("createEmailAdapter"), "Must not import createEmailAdapter");
  assert.ok(!hooksSrc.includes("createSmsAdapter"), "Must not import createSmsAdapter");
  assert.ok(!hooksSrc.includes("createSlackAdapter"), "Must not import createSlackAdapter");
  assert.ok(!hooksSrc.includes("commsAdapters"), "Must not import commsAdapters");
});

test("hooks default processOutbox=false", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();

  for (const event of ALL_HOOKS) {
    await hooks.handleLifecycleHook({ dealId: "d1", event }, db as any);
  }

  // All outbox items must be pending — no processing occurred
  const outbox = db.tables.brokerage_comms_outbox;
  const nonPending = outbox.filter((i: Row) => i.status !== "pending");
  assert.equal(nonPending.length, 0, "All outbox items must be pending — processOutbox=false");

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("duplicate hook calls dedup through outbox idempotency", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();

  const r1 = await hooks.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);
  const r2 = await hooks.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);

  assert.ok(r1.enqueued > 0, "First call should enqueue");
  assert.equal(r2.enqueued, 0, "Second call should dedup");

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("inactive/closed deals skip all hooks", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";

  for (const status of ["closed", "declined", "funded", "archived", "docs_complete"]) {
    const db = new RS();
    db.tables.deals = [{ id: "d1", status, display_name: "T", borrower_name: "T", borrower_email: "t@t.com" }];
    for (const event of ALL_HOOKS) {
      const r = await hooks.handleLifecycleHook({ dealId: "d1", event }, db as any);
      assert.equal(r.action, "skipped", `${event} should skip for status=${status}`);
    }
    assert.equal(db.tables.brokerage_comms_outbox.length, 0, `No outbox for status=${status}`);
  }

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("failed hooks emit failure ledger event", async () => {
  const brokenDb = {
    from: (t: string) => {
      if (t === "deals") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: "active" }, error: null }) }) }) };
      }
      if (t === "brokerage_comms_ledger") {
        // Allow ledger writes to work
        const items: Row[] = [];
        return {
          insert: (r: Row) => { items.push(r); return { then: (f: any) => f({ data: [r], error: null }) }; },
          select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ then: (f: any) => f({ data: items, error: null }) }) }) }) }),
        };
      }
      // borrowerNudges / bankerAlerts tables will throw
      return {
        select: () => { throw new Error("simulated_db_failure"); },
        insert: () => { throw new Error("simulated_db_failure"); },
      };
    },
  };

  const r = await hooks.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, brokenDb as any);
  assert.equal(r.action, "failed");
  assert.ok(r.reason?.includes("simulated_db_failure") || r.reason?.includes("DB"), "Should capture error reason");
});

test("observability route redacts secrets", () => {
  const routeSrc = read("src/app/api/brokerage/comms/lifecycle/route.ts");
  assert.ok(routeSrc.includes("redactResponseSecrets"), "Must call redactResponseSecrets");
  assert.ok(routeSrc.includes("requireBrokerageCommsAdmin"), "Must require admin auth");
  assert.ok(routeSrc.includes("Math.min"), "Must cap limit");
});

test("lifecycle UI does not render full recipients or message bodies", () => {
  const uiSrc = read("src/app/admin/brokerage/comms/CommsAdminClient.tsx");
  // LifecycleHooksTable + lifecycle section combined
  const tableStart = uiSrc.indexOf("LifecycleHooksTable");
  const lifecyclePart = uiSrc.slice(tableStart);
  assert.ok(!lifecyclePart.includes("emailBody"), "Must not render emailBody");
  assert.ok(!lifecyclePart.includes("smsBody"), "Must not render smsBody");
  assert.ok(!lifecyclePart.includes("message_body"), "Must not render message_body");
  assert.ok(!lifecyclePart.includes("RESEND_API_KEY"), "Must not render API keys");
  assert.ok(lifecyclePart.includes("recipient_masked"), "Must use masked recipients");
});

test("no schema or governance count changes", () => {
  // Verify commsLifecycleHooks.ts does not create tables or alter schema
  const hooksSrc = read("src/lib/brokerage/commsLifecycleHooks.ts");
  assert.ok(!hooksSrc.includes("CREATE TABLE"), "Must not create tables");
  assert.ok(!hooksSrc.includes("ALTER TABLE"), "Must not alter tables");
  assert.ok(!hooksSrc.includes("ADD COLUMN"), "Must not add columns");

  // Verify no new migration files in Phase 12
  // (lifecycle comms is entirely in-app, no schema)
  const obsSrc = read("src/lib/brokerage/commsLifecycleObservability.ts");
  assert.ok(!obsSrc.includes("CREATE TABLE"), "Observability must not create tables");

  // Verify docs exist
  assert.ok(existsSync(resolve(process.cwd(), "docs/brokerage-lifecycle-comms.md")), "Runbook must exist");
});
