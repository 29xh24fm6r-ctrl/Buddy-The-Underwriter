/**
 * Phase 13D — Timeline closeout regression.
 *
 * Locks the cross-cutting invariants of the Phase 13 timeline stack
 * (13A unify, 13B filters/deep-links, 13C export). Any failure here
 * means a Phase 13 contract has regressed; fix the regression rather
 * than the test.
 *
 * The individual test files (dealTimeline.test.ts,
 * dealTimelineFilters.test.ts, dealTimelineExport.test.ts) cover
 * unit-level behavior. This file covers the *invariants* — read-only
 * aggregation, normalized-only export, no raw bodies, no external URLs
 * in hrefs/exports, limit caps, invalid-filter tolerance, and the
 * presence of the closeout doc.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const tl = require("../dealTimeline") as typeof import("../dealTimeline");
const exp = require("../dealTimelineExport") as typeof import("../dealTimelineExport");

type Row = Record<string, any>;

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// ── Shared in-memory Supabase stub (matches sibling test files) ────────────

class RS {
  tables: Record<string, Row[]> = {
    deal_events: [],
    deal_pipeline_ledger: [],
    deal_timeline_events: [],
    brokerage_comms_ledger: [],
    brokerage_comms_outbox: [],
  };
  reads: string[] = [];
  writes: string[] = [];
  from(t: string) { this.reads.push(t); return new RQ(this, t); }
}

class RQ {
  db: RS; table: string; filters: Array<{ t: string; k: string; v: any }>; _l: number | null; _ord: { key: string; asc: boolean } | null;
  constructor(db: RS, t: string) { this.db = db; this.table = t; this.filters = []; this._l = null; this._ord = null; }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  insert() { this.db.writes.push(`insert:${this.table}`); throw new Error("write attempted"); }
  update() { this.db.writes.push(`update:${this.table}`); throw new Error("write attempted"); }
  delete() { this.db.writes.push(`delete:${this.table}`); throw new Error("write attempted"); }
  upsert() { this.db.writes.push(`upsert:${this.table}`); throw new Error("write attempted"); }
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

function seedHostileDb(): RS {
  const db = new RS();
  // A deal_events row stuffed with everything we must NOT leak.
  db.tables.deal_events = [
    {
      id: "e1",
      deal_id: "d1",
      kind: "document.uploaded",
      payload: {
        original_filename: "tax_return.pdf",
        document_id: "doc-1",
        body: "Dear borrower, please submit your tax returns by Friday.",
        emailBody: "<html>SECRET CONTENT</html>",
        smsBody: "Your verification code is 123456",
        message_body: "internal slack thread",
        webhook_url: "https://hooks.slack.com/services/T00/B00/secrettoken",
        signed_url: "https://storage.googleapis.com/bucket/file?X-Goog-Signature=xyz",
        s3_url: "https://my-bucket.s3.us-east-1.amazonaws.com/file?signed=1",
        azure_url: "https://acc.blob.core.windows.net/c/file?sig=z",
        storage_path: "gs://buddy-bucket/secret-path/file.pdf",
        RESEND_API_KEY: "re_supersecretkey12345",
        bearer: "Bearer ya29.A0AfH6SMBxyz123",
      },
      created_at: "2026-05-14T10:00:00Z",
    },
  ];
  db.tables.brokerage_comms_outbox = [
    {
      id: "o1",
      channel: "email",
      status: "sent",
      recipient: "john.doe.fullname@example.com",
      trigger_key: "documents_received",
      deal_id: "d1",
      attempt_count: 1,
      created_at: "2026-05-14T12:00:00Z",
    },
    {
      id: "o2",
      channel: "sms",
      status: "sent",
      recipient: "+12025551234",
      trigger_key: "test",
      deal_id: "d1",
      attempt_count: 1,
      created_at: "2026-05-14T12:01:00Z",
    },
  ];
  return db;
}

// ── Invariant 1: read-only aggregation ─────────────────────────────────────

test("CLOSEOUT: timeline aggregation remains read-only", async () => {
  const db = seedHostileDb();
  await tl.getDealTimeline("d1", db as any);
  assert.equal(db.writes.length, 0, `Timeline must not write; saw: ${db.writes.join(", ")}`);

  // Source-level: no write surface in dealTimeline.ts
  const src = read("src/lib/brokerage/dealTimeline.ts");
  assert.ok(!src.includes(".insert("), "dealTimeline.ts must not insert");
  assert.ok(!src.includes(".update("), "dealTimeline.ts must not update");
  assert.ok(!src.includes(".delete("), "dealTimeline.ts must not delete");
  assert.ok(!src.includes(".upsert("), "dealTimeline.ts must not upsert");
  assert.ok(!/CREATE\s+TABLE/i.test(src), "must not create tables");
  assert.ok(!/ALTER\s+TABLE/i.test(src), "must not alter tables");
});

// ── Invariant 2: export uses normalized timeline output only ──────────────

test("CLOSEOUT: export only uses normalized timeline output", async () => {
  const src = read("src/lib/brokerage/dealTimelineExport.ts");
  assert.ok(src.includes("getDealTimeline"), "Export must call getDealTimeline");
  // No direct DB surface
  assert.ok(!/\bsb\.from\(/.test(src), "Export must not call sb.from() directly");
  for (const t of ["deal_events", "deal_pipeline_ledger", "deal_timeline_events", "brokerage_comms_ledger", "brokerage_comms_outbox"]) {
    assert.ok(!src.includes(`"${t}"`), `Export must not reference source table ${t} directly`);
  }
  // No write surface
  assert.ok(!src.includes(".insert("), "Export must not insert");
  assert.ok(!src.includes(".update("), "Export must not update");
  assert.ok(!src.includes(".delete("), "Export must not delete");
  assert.ok(!src.includes(".upsert("), "Export must not upsert");

  // Behavioural check: exactly 5 source tables read (one per category source)
  const db = seedHostileDb();
  db.reads.length = 0;
  await exp.buildDealTimelineExport("d1", db as any);
  assert.equal(db.reads.length, 5, `Expected 5 source reads via getDealTimeline, saw ${db.reads.length}: ${db.reads.join(", ")}`);
});

// ── Invariant 3: no raw message bodies in timeline OR export ───────────────

test("CLOSEOUT: no raw message bodies appear in timeline or export", async () => {
  const db = seedHostileDb();

  const events = await tl.getDealTimeline("d1", db as any);
  const eventsJson = JSON.stringify(events);
  assert.ok(!eventsJson.includes("Dear borrower"), "Timeline must not include body");
  assert.ok(!eventsJson.includes("SECRET CONTENT"), "Timeline must not include emailBody");
  assert.ok(!eventsJson.includes("verification code"), "Timeline must not include smsBody");
  assert.ok(!eventsJson.includes("internal slack thread"), "Timeline must not include message_body");

  const md = await exp.buildDealTimelineExport("d1", db as any, { format: "markdown" });
  const json = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });
  for (const body of [md.body, json.body]) {
    assert.ok(!body.includes("Dear borrower"), "Export must not include body");
    assert.ok(!body.includes("SECRET CONTENT"), "Export must not include emailBody");
    assert.ok(!body.includes("verification code"), "Export must not include smsBody");
    assert.ok(!body.includes("internal slack thread"), "Export must not include message_body");
  }
});

// ── Invariant 4: no external/provider/storage URLs anywhere ────────────────

test("CLOSEOUT: no external provider/storage URLs in href or export", async () => {
  const db = seedHostileDb();
  const events = await tl.getDealTimeline("d1", db as any);

  // Hrefs must be internal-only
  for (const e of events) {
    if (e.href) {
      assert.ok(e.href.startsWith("/"), `href must be internal path, got: ${e.href}`);
      assert.ok(!/^https?:\/\//.test(e.href), `href must not be absolute URL: ${e.href}`);
      assert.ok(!e.href.includes("hooks.slack.com"), `href must not be Slack webhook: ${e.href}`);
      assert.ok(!e.href.includes("storage.googleapis.com"), `href must not be GCS URL: ${e.href}`);
      assert.ok(!e.href.includes("amazonaws.com"), `href must not be S3 URL: ${e.href}`);
      assert.ok(!e.href.includes("blob.core.windows.net"), `href must not be Azure URL: ${e.href}`);
    }
  }

  // Full payloads also scrubbed
  const eventsJson = JSON.stringify(events);
  assert.ok(!eventsJson.includes("hooks.slack.com"), "Timeline must not leak Slack webhook URL");
  assert.ok(!eventsJson.includes("X-Goog-Signature"), "Timeline must not leak signed URL signature");
  assert.ok(!eventsJson.includes("re_supersecretkey12345"), "Timeline must not leak API key");

  const md = await exp.buildDealTimelineExport("d1", db as any, { format: "markdown" });
  const json = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });
  for (const body of [md.body, json.body]) {
    assert.ok(!body.includes("hooks.slack.com"), "Export must not leak Slack webhook URL");
    assert.ok(!body.includes("X-Goog-Signature"), "Export must not leak signed URL signature");
    assert.ok(!body.includes("storage.googleapis.com/bucket"), "Export must not leak GCS URL");
    assert.ok(!body.includes("s3.us-east-1.amazonaws.com"), "Export must not leak S3 URL");
    assert.ok(!body.includes("blob.core.windows.net"), "Export must not leak Azure URL");
    assert.ok(!/gs:\/\/buddy-bucket/.test(body), "Export must not leak gs:// path");
    assert.ok(!body.includes("re_supersecretkey12345"), "Export must not leak API key");
  }
});

// ── Invariant 5: limit caps — 200 timeline, 500 export ─────────────────────

test("CLOSEOUT: limit caps enforced (200 timeline, 500 export)", async () => {
  const db = new RS();
  // Seed 700 events across the day
  for (let i = 0; i < 700; i++) {
    db.tables.deal_events.push({
      id: `e${i}`,
      deal_id: "d1",
      kind: "document.uploaded",
      payload: {},
      created_at: `2026-05-14T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
    });
  }

  // Timeline cap = 200
  const tlEvents = await tl.getDealTimeline("d1", db as any, { limit: 9999 });
  assert.ok(tlEvents.length <= 200, `Timeline must cap at 200, got ${tlEvents.length}`);

  // Export cap = 500 (echoed in metadata)
  const ex = await exp.buildDealTimelineExport("d1", db as any, { format: "json", limit: 9999 });
  const parsed = JSON.parse(ex.body);
  assert.equal(parsed.metadata.appliedFilters.limit, 500, "Export metadata must reflect capped 500");
  // The actual event count is bounded by the timeline's 200 internal cap;
  // either bound is acceptable as long as nothing exceeds 500.
  assert.ok(parsed.events.length <= 500, `Export must cap at 500, got ${parsed.events.length}`);
});

// ── Invariant 6: invalid filter values are silently ignored ────────────────

test("CLOSEOUT: invalid filter values are ignored safely", async () => {
  const db = seedHostileDb();
  const all = await tl.getDealTimeline("d1", db as any);

  const garbageTimeline = await tl.getDealTimeline("d1", db as any, {
    categories: ["nonsense" as any, "fake" as any],
    severities: ["bogus" as any],
    actorTypes: ["alien" as any],
    from: "not-a-date",
    to: "also-not-a-date",
  });
  assert.equal(garbageTimeline.length, all.length, "Invalid filters must leave timeline unfiltered");

  const garbageExport = await exp.buildDealTimelineExport("d1", db as any, {
    format: "json",
    categories: ["nonsense" as any],
    severities: ["bogus" as any],
    actorTypes: ["alien" as any],
    from: "not-a-date",
    to: "also-not-a-date",
  });
  const parsed = JSON.parse(garbageExport.body);
  assert.equal(parsed.metadata.appliedFilters.categories, null);
  assert.equal(parsed.metadata.appliedFilters.severities, null);
  assert.equal(parsed.metadata.appliedFilters.actorTypes, null);
  assert.equal(parsed.metadata.appliedFilters.from, null);
  assert.equal(parsed.metadata.appliedFilters.to, null);
  assert.equal(parsed.events.length, all.length, "Invalid filters must leave export unfiltered");
});

// ── Invariant 7: closeout doc exists ───────────────────────────────────────

test("CLOSEOUT: brokerage-timeline.md doc exists with required sections", () => {
  const docPath = "docs/brokerage-timeline.md";
  assert.ok(existsSync(docPath), `Missing closeout doc: ${docPath}`);

  const md = read(docPath);
  for (const heading of [
    "# Brokerage Deal Timeline",
    "Phase 13A",
    "Phase 13B",
    "Phase 13C",
    "Redaction guarantees",
    "Read-only invariant",
    "Limit caps",
    "Troubleshooting",
  ]) {
    assert.ok(md.includes(heading), `Doc must mention "${heading}"`);
  }
});

// ── Invariant 8: regression script exists in package.json ──────────────────

test("CLOSEOUT: pnpm brokerage:timeline:regression script is registered", () => {
  const pkg = JSON.parse(read("package.json"));
  const script = pkg?.scripts?.["brokerage:timeline:regression"];
  assert.ok(typeof script === "string" && script.length > 0, "Missing pnpm script brokerage:timeline:regression");
  // Must invoke node --test on the three timeline test files plus this closeout file
  assert.ok(script.includes("dealTimeline.test.ts"), "Regression script must include dealTimeline.test.ts");
  assert.ok(script.includes("dealTimelineFilters.test.ts"), "Regression script must include dealTimelineFilters.test.ts");
  assert.ok(script.includes("dealTimelineExport.test.ts"), "Regression script must include dealTimelineExport.test.ts");
  assert.ok(script.includes("timelineCloseoutRegression.test.ts"), "Regression script must include this closeout test");
});
