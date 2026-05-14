import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../dealTimeline") as typeof import("../dealTimeline");

type Row = Record<string, any>;

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// ── In-memory Supabase stub ────────────────────────────────────────────────

class RS {
  tables: Record<string, Row[]> = {
    deal_events: [],
    deal_pipeline_ledger: [],
    deal_timeline_events: [],
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

// ── Regression tests ──────────────────────────────────────────────────────

test("document events normalize correctly", () => {
  const row = { id: "e1", deal_id: "d1", kind: "document.uploaded", payload: { original_filename: "tax_return.pdf", source: "borrower" }, created_at: "2026-05-14T10:00:00Z" };
  const e = m.normalizeTimelineEvent("deal_events", row, "d1");
  assert.ok(e);
  assert.equal(e!.category, "document");
  assert.equal(e!.title, "Document uploaded");
  assert.equal(e!.severity, "success");
  assert.equal(e!.actorType, "borrower");
  assert.ok(e!.description.includes("tax_return.pdf"));
});

test("readiness events normalize correctly", () => {
  const readyEvent = { id: "e2", deal_id: "d1", kind: "ready_reverted", payload: { reason: "Checklist incomplete" }, created_at: "2026-05-14T11:00:00Z" };
  const e = m.normalizeTimelineEvent("deal_events", readyEvent, "d1");
  assert.ok(e);
  assert.equal(e!.category, "readiness");
  assert.equal(e!.severity, "warning");
  assert.ok(e!.title.includes("reverted"));
});

test("comms ledger events normalize correctly", () => {
  const row = { id: "c1", event_type: "brokerage_comms_send_succeeded", channel: "email", deal_id: "d1", recipient_masked: "j**n@example.com", metadata: { triggerKey: "documents_received" }, created_at: "2026-05-14T12:00:00Z" };
  const e = m.normalizeTimelineEvent("brokerage_comms_ledger", row, "d1");
  assert.ok(e);
  assert.equal(e!.category, "comms");
  assert.equal(e!.severity, "success");
  assert.ok(e!.title.includes("send succeeded"));
});

test("send/retry/failure outbox events normalize correctly", () => {
  const sent = { id: "o1", channel: "email", status: "sent", recipient: "john@example.com", trigger_key: "documents_received", deal_id: "d1", attempt_count: 1, created_at: "2026-05-14T13:00:00Z" };
  const failed = { id: "o2", channel: "sms", status: "failed", recipient: "+12025551234", trigger_key: "missing_documents", deal_id: "d1", attempt_count: 3, created_at: "2026-05-14T13:01:00Z" };
  const retry = { id: "o3", channel: "email", status: "retry_scheduled", recipient: "banker@test.com", trigger_key: "deal_ready_for_review", deal_id: "d1", attempt_count: 2, created_at: "2026-05-14T13:02:00Z" };

  const eSent = m.normalizeTimelineEvent("brokerage_comms_outbox", sent, "d1");
  const eFailed = m.normalizeTimelineEvent("brokerage_comms_outbox", failed, "d1");
  const eRetry = m.normalizeTimelineEvent("brokerage_comms_outbox", retry, "d1");

  assert.equal(eSent!.severity, "success");
  assert.equal(eFailed!.severity, "error");
  assert.equal(eRetry!.severity, "warning");
  assert.equal(eSent!.category, "comms");
});

test("recipients are masked in timeline events", () => {
  const outboxRow = { id: "o1", channel: "email", status: "sent", recipient: "john.doe@example.com", trigger_key: "test", deal_id: "d1", attempt_count: 1, created_at: "2026-05-14T14:00:00Z" };
  const e = m.normalizeTimelineEvent("brokerage_comms_outbox", outboxRow, "d1");
  assert.ok(e);
  assert.ok(!e!.description.includes("john.doe@example.com"), "Full email must not appear");
  assert.ok(e!.description.includes("j"), "Masked email should start with first char");
  assert.ok(e!.description.includes("@example.com"), "Domain should be visible");

  const phoneRow = { id: "o2", channel: "sms", status: "sent", recipient: "+12025551234", trigger_key: "test", deal_id: "d1", attempt_count: 1, created_at: "2026-05-14T14:01:00Z" };
  const ep = m.normalizeTimelineEvent("brokerage_comms_outbox", phoneRow, "d1");
  assert.ok(!ep!.description.includes("+12025551234"), "Full phone must not appear");
  assert.ok(ep!.description.includes("1234"), "Last 4 digits should be visible");
});

test("secrets are redacted from timeline events", () => {
  const row = { id: "e1", deal_id: "d1", kind: "comms_error", payload: { error: "Bearer re_abc123defghijklm failed", RESEND_API_KEY: "re_supersecret123" }, created_at: "2026-05-14T15:00:00Z" };
  const e = m.normalizeTimelineEvent("deal_events", row, "d1");
  assert.ok(e);
  const json = JSON.stringify(e);
  assert.ok(!json.includes("re_abc123defghijklm"), "Must not contain API key");
  assert.ok(!json.includes("re_supersecret123"), "Must not contain Resend key");
});

test("events group by day", () => {
  const events: import("../dealTimeline").TimelineEvent[] = [
    { id: "1", dealId: "d1", timestamp: "2026-05-14T10:00:00Z", category: "document", title: "A", description: "", actorType: "system", severity: "info", relatedEntityType: null, relatedEntityId: null, metadataSafe: {}, href: null },
    { id: "2", dealId: "d1", timestamp: "2026-05-14T14:00:00Z", category: "comms", title: "B", description: "", actorType: "system", severity: "info", relatedEntityType: null, relatedEntityId: null, metadataSafe: {}, href: null },
    { id: "3", dealId: "d1", timestamp: "2026-05-13T10:00:00Z", category: "readiness", title: "C", description: "", actorType: "system", severity: "info", relatedEntityType: null, relatedEntityId: null, metadataSafe: {}, href: null },
  ];
  const groups = m.groupTimelineEventsByDay(events);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, "2026-05-14"); // newest first
  assert.equal(groups[0].events.length, 2);
  assert.equal(groups[1].date, "2026-05-13");
  assert.equal(groups[1].events.length, 1);
});

test("ordering is newest-first by default", async () => {
  const db = new RS();
  db.tables.deal_events = [
    { id: "e1", deal_id: "d1", kind: "document.uploaded", payload: {}, created_at: "2026-05-14T08:00:00Z" },
    { id: "e2", deal_id: "d1", kind: "document.uploaded", payload: {}, created_at: "2026-05-14T12:00:00Z" },
  ];
  const events = await m.getDealTimeline("d1", db as any);
  assert.ok(events.length >= 2);
  assert.ok(events[0].timestamp >= events[1].timestamp, "Must be newest-first");
});

test("UI renders grouped timeline", () => {
  const src = read("src/app/(app)/deals/[dealId]/_components/BrokerageTimelinePanel.tsx");
  assert.ok(src.includes('data-testid="brokerage-timeline-panel"'), "Must have panel testid");
  assert.ok(src.includes('data-testid="timeline-groups"'), "Must have groups container");
  assert.ok(src.includes('data-testid="timeline-day-header"'), "Must have day headers");
  assert.ok(src.includes('data-testid="timeline-event"'), "Must have event items");
  assert.ok(src.includes("CategoryBadge"), "Must render category badges");
  assert.ok(src.includes("SeverityDot"), "Must render severity indicators");
});

test("empty state renders", () => {
  const src = read("src/app/(app)/deals/[dealId]/_components/BrokerageTimelinePanel.tsx");
  assert.ok(src.includes('data-testid="timeline-empty"'), "Must have empty state testid");
  assert.ok(src.includes("No timeline activity yet."), "Must show user-friendly empty message");
});

test("no workflow/write/governance changes", () => {
  const timelineSrc = read("src/lib/brokerage/dealTimeline.ts");
  assert.ok(!timelineSrc.includes(".insert("), "Must not insert data");
  assert.ok(!timelineSrc.includes(".update("), "Must not update data");
  assert.ok(!timelineSrc.includes(".delete("), "Must not delete data");
  assert.ok(!timelineSrc.includes("CREATE TABLE"), "Must not create tables");
  assert.ok(!timelineSrc.includes("ALTER TABLE"), "Must not alter tables");
  // UI is read-only too
  const uiSrc = read("src/app/(app)/deals/[dealId]/_components/BrokerageTimelinePanel.tsx");
  assert.ok(!uiSrc.includes("method: \"POST\""), "UI must not POST");
  assert.ok(!uiSrc.includes("method: \"PUT\""), "UI must not PUT");
});
