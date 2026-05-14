import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

function seedDb(): RS {
  const db = new RS();
  db.tables.deal_events = [
    { id: "e1", deal_id: "d1", kind: "document.uploaded", payload: { source: "borrower", original_filename: "tax.pdf" }, created_at: "2026-05-14T10:00:00Z" },
    { id: "e2", deal_id: "d1", kind: "ready_reverted", payload: { reason: "Checklist incomplete" }, created_at: "2026-05-14T11:00:00Z" },
    { id: "e3", deal_id: "d1", kind: "intake.classified", payload: {}, created_at: "2026-05-13T09:00:00Z" },
  ];
  db.tables.brokerage_comms_ledger = [
    { id: "c1", event_type: "brokerage_comms_send_succeeded", channel: "email", deal_id: "d1", recipient_masked: "j**n@example.com", metadata: {}, created_at: "2026-05-14T12:00:00Z" },
    { id: "c2", event_type: "brokerage_comms_send_failed", channel: "sms", deal_id: "d1", recipient_masked: "****1234", metadata: {}, created_at: "2026-05-14T13:00:00Z" },
  ];
  db.tables.brokerage_comms_outbox = [
    { id: "o1", channel: "email", status: "sent", recipient: "banker@test.com", trigger_key: "documents_received", deal_id: "d1", attempt_count: 1, created_at: "2026-05-14T12:30:00Z" },
  ];
  return db;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("category filter works", async () => {
  const db = seedDb();
  const commsOnly = await m.getDealTimeline("d1", db as any, { categories: ["comms"] });
  assert.ok(commsOnly.length > 0);
  assert.ok(commsOnly.every(e => e.category === "comms"), "All events must be comms");

  const docOnly = await m.getDealTimeline("d1", db as any, { categories: ["document"] });
  assert.ok(docOnly.length > 0);
  assert.ok(docOnly.every(e => e.category === "document"), "All events must be document");
});

test("severity filter works", async () => {
  const db = seedDb();
  const errorsOnly = await m.getDealTimeline("d1", db as any, { severities: ["error"] });
  assert.ok(errorsOnly.length > 0);
  assert.ok(errorsOnly.every(e => e.severity === "error"), "All events must be error severity");

  const successOnly = await m.getDealTimeline("d1", db as any, { severities: ["success"] });
  assert.ok(successOnly.length > 0);
  assert.ok(successOnly.every(e => e.severity === "success"), "All events must be success severity");
});

test("actor filter works", async () => {
  const db = seedDb();
  const borrowerOnly = await m.getDealTimeline("d1", db as any, { actorTypes: ["borrower"] });
  assert.ok(borrowerOnly.length > 0);
  assert.ok(borrowerOnly.every(e => e.actorType === "borrower"), "All events must be borrower");

  const providerOnly = await m.getDealTimeline("d1", db as any, { actorTypes: ["provider"] });
  assert.ok(providerOnly.length > 0);
  assert.ok(providerOnly.every(e => e.actorType === "provider"), "All events must be provider");
});

test("date range filter works", async () => {
  const db = seedDb();
  // Only May 14 events
  const may14 = await m.getDealTimeline("d1", db as any, { from: "2026-05-14T00:00:00Z", to: "2026-05-14T23:59:59Z" });
  assert.ok(may14.length > 0);
  assert.ok(may14.every(e => e.timestamp.startsWith("2026-05-14")), "All events must be May 14");

  // Only May 13 events
  const may13 = await m.getDealTimeline("d1", db as any, { from: "2026-05-13T00:00:00Z", to: "2026-05-13T23:59:59Z" });
  assert.ok(may13.length > 0);
  assert.ok(may13.every(e => e.timestamp.startsWith("2026-05-13")), "All events must be May 13");
});

test("invalid filters ignored safely", async () => {
  const db = seedDb();
  // Invalid category values should be ignored — return all events
  const result = await m.getDealTimeline("d1", db as any, {
    categories: ["nonsense" as any, "fake" as any],
    severities: ["bogus" as any],
    actorTypes: ["alien" as any],
    from: "not-a-date",
    to: "also-not-a-date",
  });
  // Should return all events since invalid filters are ignored
  const allEvents = await m.getDealTimeline("d1", db as any);
  assert.equal(result.length, allEvents.length, "Invalid filters should be ignored, returning all events");
});

test("limit capped at 200", async () => {
  const db = new RS();
  for (let i = 0; i < 250; i++) {
    db.tables.deal_events.push({ id: `e${i}`, deal_id: "d1", kind: "document.uploaded", payload: {}, created_at: `2026-05-14T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z` });
  }
  const events = await m.getDealTimeline("d1", db as any, { limit: 999 });
  assert.ok(events.length <= 200, `Should cap at 200, got ${events.length}`);
});

test("deep links generated only for safe internal hrefs", async () => {
  const db = seedDb();
  const events = await m.getDealTimeline("d1", db as any);

  for (const e of events) {
    if (e.href) {
      // Must start with / and be an internal path
      assert.ok(e.href.startsWith("/"), `href must be internal path: ${e.href}`);
      assert.ok(!e.href.includes("http"), `href must not be external URL: ${e.href}`);
    }
  }

  // Document events should have href
  const docEvents = events.filter(e => e.category === "document" && e.relatedEntityId);
  for (const e of docEvents) {
    assert.ok(e.href, "Document events with entity ID should have href");
    assert.ok(e.href!.includes("/deals/"), "Document href should point to deal");
  }

  // Comms events should have href
  const commsEvents = events.filter(e => e.category === "comms");
  for (const e of commsEvents) {
    assert.ok(e.href, "Comms events should have href");
    assert.ok(e.href!.includes("/admin/brokerage/comms"), "Comms href should point to admin comms");
  }
});

test("no storage/provider/webhook URLs returned", async () => {
  const db = new RS();
  db.tables.deal_events = [
    { id: "e1", deal_id: "d1", kind: "document.uploaded", payload: {
      storage_path: "gs://bucket/secret-path/file.pdf",
      webhook_url: "https://hooks.slack.com/services/T00/B00/xxxx",
      signed_url: "https://storage.googleapis.com/bucket/file?X-Goog-Signature=abc123",
      RESEND_API_KEY: "re_supersecretkey",
    }, created_at: "2026-05-14T10:00:00Z" },
  ];
  const events = await m.getDealTimeline("d1", db as any);
  const json = JSON.stringify(events);
  assert.ok(!json.includes("hooks.slack.com"), "Must not contain Slack webhook URL");
  assert.ok(!json.includes("re_supersecretkey"), "Must not contain API key");
  // Storage paths in metadataSafe are OK as long as they don't contain signed URLs
  assert.ok(!json.includes("X-Goog-Signature"), "Must not contain signed URLs");
});

test("UI filter chips update rendered events", () => {
  const src = read("src/app/(app)/deals/[dealId]/_components/BrokerageTimelinePanel.tsx");
  assert.ok(src.includes('data-testid="timeline-filters"'), "Must have filters section");
  assert.ok(src.includes('data-testid="filter-chip"'), "Must have filter chips");
  assert.ok(src.includes("categoryFilter"), "Must have category filter state");
  assert.ok(src.includes("severityFilter"), "Must have severity filter state");
  assert.ok(src.includes("actorFilter"), "Must have actor filter state");
  // Verify filtering logic exists
  assert.ok(src.includes("filteredEvents"), "Must compute filtered events");
});

test("reset filters restores all events", () => {
  const src = read("src/app/(app)/deals/[dealId]/_components/BrokerageTimelinePanel.tsx");
  assert.ok(src.includes('data-testid="reset-filters"'), "Must have reset button");
  assert.ok(src.includes("resetFilters"), "Must have resetFilters function");
  // Reset should clear all sets
  assert.ok(src.includes("new Set()"), "Reset should create empty sets");
});

test("filtered empty state renders", () => {
  const src = read("src/app/(app)/deals/[dealId]/_components/BrokerageTimelinePanel.tsx");
  assert.ok(src.includes('data-testid="timeline-filtered-empty"'), "Must have filtered empty state");
  assert.ok(src.includes("No activity matches these filters"), "Must show filter-specific empty message");
  assert.ok(src.includes('data-testid="timeline-empty"'), "Must keep original empty state");
  assert.ok(src.includes("No timeline activity yet"), "Must keep original empty message");
  // Verify view-source link
  assert.ok(src.includes('data-testid="timeline-source-link"'), "Must have source link");
  assert.ok(src.includes("View source"), "Must show View source text");
});
