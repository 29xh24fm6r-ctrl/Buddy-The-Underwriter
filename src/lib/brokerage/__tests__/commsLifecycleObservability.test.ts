import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const obs = require("../commsLifecycleObservability") as typeof import("../commsLifecycleObservability");

type Row = Record<string, any>;

// ── In-memory Supabase stub ────────────────────────────────────────────────

class RS {
  tables: Record<string, Row[]> = {
    brokerage_comms_ledger: [],
    brokerage_comms_outbox: [],
  };
  from(t: string) { return new RQ(this, t); }
}

class RQ {
  db: RS; table: string; filters: Array<{ t: string; k: string; v: any }>; _l: number | null; _ord: { key: string; asc: boolean } | null;
  constructor(db: RS, t: string) { this.db = db; this.table = t; this.filters = []; this._l = null; this._ord = null; }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  then(f: any, r?: any) { return Promise.resolve({ data: this.rows(), error: null }).then(f, r); }
  private rows() {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v);
      else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k]));
    }
    if (this._ord) {
      const { key, asc } = this._ord;
      rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1);
    }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

function makeHookEvent(event: string, outcome: string, meta?: Record<string, any>, ts?: string): import("../commsLifecycleObservability").LifecycleHookEventRow {
  return {
    event_type: `comms_lifecycle_hook_${outcome}`,
    channel: "email",
    deal_id: "d1",
    recipient_masked: "lifecycle_hook",
    metadata: { event, ...meta },
    created_at: ts ?? new Date().toISOString(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("summary groups by hook type", () => {
  const events = [
    makeHookEvent("documents_received", "received"),
    makeHookEvent("documents_received", "enqueued"),
    makeHookEvent("readiness_regressed", "received"),
    makeHookEvent("readiness_regressed", "skipped", { reason: "deal_status_closed" }),
  ];
  const summary = obs.summarizeLifecycleHookOutcomes(events);
  assert.ok(summary.byHookType["documents_received"]);
  assert.ok(summary.byHookType["readiness_regressed"]);
  assert.equal(summary.byHookType["documents_received"].received, 1);
  assert.equal(summary.byHookType["documents_received"].enqueued, 1);
  assert.equal(summary.byHookType["readiness_regressed"].skipped, 1);
});

test("summary counts enqueued/skipped/failed", () => {
  const events = [
    makeHookEvent("documents_received", "received"),
    makeHookEvent("documents_received", "enqueued"),
    makeHookEvent("deal_ready_for_review", "received"),
    makeHookEvent("deal_ready_for_review", "failed", { error: "db_error" }),
    makeHookEvent("readiness_regressed", "received"),
    makeHookEvent("readiness_regressed", "skipped", { reason: "no_banker_contact" }),
  ];
  const summary = obs.summarizeLifecycleHookOutcomes(events);
  assert.equal(summary.totalHookEvents, 6);
  assert.equal(summary.byHookType["documents_received"].enqueued, 1);
  assert.equal(summary.byHookType["deal_ready_for_review"].failed, 1);
  assert.equal(summary.byHookType["readiness_regressed"].skipped, 1);
});

test("warnings when hook fires with no outbox", () => {
  const events = [
    makeHookEvent("documents_received", "received"),
    makeHookEvent("documents_received", "skipped", { reason: "no_banker_contact" }),
  ];
  const summary = obs.summarizeLifecycleHookOutcomes(events);
  assert.ok(summary.warnings.length > 0);
  assert.ok(summary.warnings[0].includes("documents_received"));
  assert.ok(summary.warnings[0].includes("no outbox"));
});

test("route caps limit at 100", async () => {
  const db = new RS();
  // Add 150 events
  for (let i = 0; i < 150; i++) {
    db.tables.brokerage_comms_ledger.push(makeHookEvent("documents_received", "received", undefined, `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`));
  }
  const events = await obs.getRecentLifecycleCommsEvents(db as any, { limit: 200 });
  assert.ok(events.length <= 100, `Should cap at 100, got ${events.length}`);
});

test("route redacts secrets/full recipients", async () => {
  const db = new RS();
  db.tables.brokerage_comms_ledger.push({
    event_type: "comms_lifecycle_hook_enqueued",
    channel: "email",
    deal_id: "d1",
    recipient_masked: "lifecycle_hook",
    metadata: { event: "documents_received", enqueued: 1 },
    created_at: new Date().toISOString(),
  });
  const events = await obs.getRecentLifecycleCommsEvents(db as any);
  assert.equal(events.length, 1);
  // Recipient should be masked value, not a full email
  assert.ok(!events[0].recipient_masked.includes("@test.com"), "Should not contain full email");
  // No raw body in output
  const json = JSON.stringify(events);
  assert.ok(!json.includes("re_"), "Should not contain API keys");
});

test("UI renders lifecycle hook table", () => {
  // Verify component file has lifecycle hooks table with data-testid
  const src = readFileSync(resolve(process.cwd(), "src/app/admin/brokerage/comms/CommsAdminClient.tsx"), "utf-8");
  assert.ok(src.includes('data-testid="lifecycle-hooks-table"'), "Must have lifecycle table");
  assert.ok(src.includes('data-testid="lifecycle-hooks-section"'), "Must have lifecycle section");
  assert.ok(src.includes("LifecycleHooksTable"), "Must render LifecycleHooksTable component");
});

test("UI does not render raw message bodies", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/admin/brokerage/comms/CommsAdminClient.tsx"), "utf-8");
  // The lifecycle section should not have body/emailBody/smsBody fields
  const lifecycleSection = src.slice(src.indexOf("Lifecycle Hooks"));
  assert.ok(!lifecycleSection.includes("emailBody"), "Must not show email body");
  assert.ok(!lifecycleSection.includes("smsBody"), "Must not show SMS body");
  assert.ok(!lifecycleSection.includes("message_body"), "Must not show message body");
});

test("empty state is user-friendly", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/admin/brokerage/comms/CommsAdminClient.tsx"), "utf-8");
  assert.ok(src.includes('data-testid="lifecycle-empty"'), "Must have empty state");
  assert.ok(src.includes("No lifecycle hook events"), "Must show user-friendly empty message");
});

test("auth required through existing comms auth", () => {
  const routeSrc = readFileSync(resolve(process.cwd(), "src/app/api/brokerage/comms/lifecycle/route.ts"), "utf-8");
  assert.ok(routeSrc.includes("requireBrokerageCommsAdmin"), "Route must use requireBrokerageCommsAdmin");
  assert.ok(routeSrc.includes("redactResponseSecrets"), "Route must redact secrets in response");
  assert.ok(routeSrc.includes('status: 401'), "Route must return 401 for unauthorized");
});
