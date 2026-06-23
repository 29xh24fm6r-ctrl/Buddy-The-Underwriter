import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const exp = require("../dealTimelineExport") as typeof import("../dealTimelineExport");
const tl = require("../dealTimeline") as typeof import("../dealTimeline");

type Row = Record<string, any>;

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// ── In-memory Supabase stub (mirrors other timeline tests) ─────────────────

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
    { id: "e1", deal_id: "d1", kind: "document.uploaded", payload: { source: "borrower", original_filename: "tax.pdf", document_id: "doc-1" }, created_at: "2026-05-14T10:00:00Z" },
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

// ── Markdown format ────────────────────────────────────────────────────────

test("markdown export includes metadata header and grouped events", async () => {
  const db = seedDb();
  const result = await exp.buildDealTimelineExport("d1", db as any, { format: "markdown" });
  assert.equal(result.format, "markdown");
  assert.ok(result.body.includes("# Deal Timeline Export"), "Must have title");
  assert.ok(result.body.includes("**Deal ID:**"), "Must show deal id");
  assert.ok(result.body.includes("**Generated:**"), "Must show generated timestamp");
  assert.ok(result.body.includes("**Events:**"), "Must show event count");
  assert.ok(result.body.includes("**Export version:**"), "Must show export version");
  assert.ok(result.body.includes("## Applied filters"), "Must show applied filters section");
  assert.ok(result.body.includes("## Source summary"), "Must show source summary section");
  assert.ok(result.body.includes("## Events"), "Must show events section");

  // Day grouping
  assert.ok(result.body.includes("### 2026-05-14"), "Must group by day with date header");
  assert.ok(result.body.includes("### 2026-05-13"), "Must group second day");

  // Event lines render with category/severity/actor
  assert.ok(/`document\//.test(result.body), "Must render category tag");
});

test("json export includes metadata and events array", async () => {
  const db = seedDb();
  const result = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });
  assert.equal(result.format, "json");
  const parsed = JSON.parse(result.body);
  assert.ok(parsed.metadata, "Must include metadata");
  assert.ok(Array.isArray(parsed.events), "Must include events array");
  assert.equal(parsed.metadata.dealId, "d1");
  assert.equal(parsed.metadata.exportVersion, "timeline_export_v1");
  assert.equal(parsed.metadata.eventCount, parsed.events.length);
  assert.ok(parsed.metadata.sourceSummary, "Must include source summary");
  assert.ok(parsed.metadata.redactionNotice, "Must include redaction notice");
  assert.ok(parsed.metadata.appliedFilters, "Must include applied filters");
});

// ── Source-of-truth contract ───────────────────────────────────────────────

test("export uses normalized getDealTimeline output only", async () => {
  // The export module must call getDealTimeline; it must never touch source
  // tables directly. Verify this by patching the timeline module and
  // by source inspection.
  const src = read("src/lib/brokerage/dealTimelineExport.ts");
  // Source-level invariant: only one DB-shaped call surface — getDealTimeline
  assert.ok(src.includes("getDealTimeline"), "Must call getDealTimeline");
  assert.ok(!/\bsb\.from\(/.test(src), "Export module must not call sb.from() directly");
  assert.ok(!src.includes('.from("deal_events"'), "Must not query raw deal_events");
  assert.ok(!src.includes('.from("deal_pipeline_ledger"'), "Must not query raw pipeline ledger");
  assert.ok(!src.includes('.from("brokerage_comms_ledger"'), "Must not query raw comms ledger");
  assert.ok(!src.includes('.from("brokerage_comms_outbox"'), "Must not query raw comms outbox");

  // Behavioural check: spy on getDealTimeline by counting db reads.
  const db = seedDb();
  let fromCalls = 0;
  const wrapped = { from: (t: string) => { fromCalls += 1; return (db as any).from(t); } };
  await exp.buildDealTimelineExport("d1", wrapped as any);
  // getDealTimeline reads 5 source tables once each
  assert.equal(fromCalls, 5, "Should be exactly the 5 source tables queried by getDealTimeline");
});

// ── Filters ────────────────────────────────────────────────────────────────

test("filters are applied through to export output", async () => {
  const db = seedDb();
  const result = await exp.buildDealTimelineExport("d1", db as any, {
    format: "json",
    categories: ["comms"],
  });
  const parsed = JSON.parse(result.body);
  assert.ok(parsed.events.length > 0);
  assert.ok(parsed.events.every((e: any) => e.category === "comms"), "All exported events must be comms");
  assert.deepEqual(parsed.metadata.appliedFilters.categories, ["comms"], "Metadata must echo applied filter");

  const sev = await exp.buildDealTimelineExport("d1", db as any, {
    format: "json",
    severities: ["error"],
  });
  const sevParsed = JSON.parse(sev.body);
  assert.ok(sevParsed.events.every((e: any) => e.severity === "error"), "All exported events must be error severity");

  // Invalid filter values are dropped (echoed as null in metadata)
  const bogus = await exp.buildDealTimelineExport("d1", db as any, {
    format: "json",
    categories: ["nonsense" as any],
    severities: ["bogus" as any],
    actorTypes: ["alien" as any],
    from: "not-a-date",
    to: "also-not-a-date",
  });
  const bogusParsed = JSON.parse(bogus.body);
  assert.equal(bogusParsed.metadata.appliedFilters.categories, null);
  assert.equal(bogusParsed.metadata.appliedFilters.severities, null);
  assert.equal(bogusParsed.metadata.appliedFilters.actorTypes, null);
  assert.equal(bogusParsed.metadata.appliedFilters.from, null);
  assert.equal(bogusParsed.metadata.appliedFilters.to, null);
});

// ── Limit cap ─────────────────────────────────────────────────────────────

test("limit is capped at 500 in the export API", async () => {
  const db = new RS();
  for (let i = 0; i < 600; i++) {
    db.tables.deal_events.push({
      id: `e${i}`,
      deal_id: "d1",
      kind: "document.uploaded",
      payload: { document_id: `doc-${i}` },
      created_at: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`,
    });
  }
  // Request way over cap
  const result = await exp.buildDealTimelineExport("d1", db as any, { format: "json", limit: 999 });
  const parsed = JSON.parse(result.body);
  assert.ok(parsed.events.length <= 500, `Should cap at 500, got ${parsed.events.length}`);
  assert.equal(parsed.metadata.appliedFilters.limit, 500, "Metadata must echo capped limit");

  // Default limit is 200
  const def = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });
  const defParsed = JSON.parse(def.body);
  assert.equal(defParsed.metadata.appliedFilters.limit, 200, "Default limit must be 200");
});

// ── Filename ──────────────────────────────────────────────────────────────

test("export filename is content-disposition safe", async () => {
  const db = seedDb();
  const md = await exp.buildDealTimelineExport("d1", db as any, { format: "markdown" });
  const json = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });

  assert.ok(md.filename.endsWith(".md"), "Markdown filename must end with .md");
  assert.ok(json.filename.endsWith(".json"), "JSON filename must end with .json");
  // Filename must only contain safe chars
  assert.ok(/^[A-Za-z0-9._-]+$/.test(md.filename), `Markdown filename must be safe: ${md.filename}`);
  assert.ok(/^[A-Za-z0-9._-]+$/.test(json.filename), `JSON filename must be safe: ${json.filename}`);

  // Verify weird deal IDs are sanitized
  const weird = await exp.buildDealTimelineExport("../etc/passwd; rm -rf /", db as any, { format: "markdown" });
  assert.ok(/^[A-Za-z0-9._-]+$/.test(weird.filename), `Weird deal id must produce safe filename: ${weird.filename}`);
  assert.ok(!weird.filename.includes("/"), "Filename must not contain /");
  assert.ok(!weird.filename.includes(".."), "Filename must not contain ..");
});

test("content-type is set correctly per format", () => {
  assert.equal(exp.contentTypeFor("json"), "application/json");
  assert.equal(exp.contentTypeFor("markdown"), "text/markdown; charset=utf-8");
});

// ── Safety: secrets, recipients, bodies, URLs ──────────────────────────────

test("secrets are redacted from export body", async () => {
  const db = new RS();
  db.tables.deal_events = [{
    id: "e1",
    deal_id: "d1",
    kind: "comms_error",
    payload: {
      error: "Bearer re_abc123defghijklm failed",
      RESEND_API_KEY: "re_supersecretkey12345",
      auth: "Bearer ya29.A0AfH6SMBxyz123",
    },
    created_at: "2026-05-14T10:00:00Z",
  }];

  const md = await exp.buildDealTimelineExport("d1", db as any, { format: "markdown" });
  const json = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });

  for (const body of [md.body, json.body]) {
    assert.ok(!body.includes("re_abc123defghijklm"), "Must not contain inline API key");
    assert.ok(!body.includes("re_supersecretkey12345"), "Must not contain Resend key");
    assert.ok(!body.includes("ya29.A0AfH6SMBxyz123"), "Must not contain bearer token value");
  }
});

test("full recipient addresses are not present in export", async () => {
  const db = new RS();
  db.tables.brokerage_comms_outbox = [
    { id: "o1", channel: "email", status: "sent", recipient: "john.doe.fullname@example.com", trigger_key: "t1", deal_id: "d1", attempt_count: 1, created_at: "2026-05-14T10:00:00Z" },
    { id: "o2", channel: "sms", status: "sent", recipient: "+12025551234", trigger_key: "t2", deal_id: "d1", attempt_count: 1, created_at: "2026-05-14T11:00:00Z" },
  ];
  const md = await exp.buildDealTimelineExport("d1", db as any, { format: "markdown" });
  const json = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });
  for (const body of [md.body, json.body]) {
    assert.ok(!body.includes("john.doe.fullname@example.com"), "Must not contain full email");
    assert.ok(!body.includes("+12025551234"), "Must not contain full phone");
  }
});

test("raw message bodies are not present in export", async () => {
  const db = new RS();
  db.tables.deal_events = [{
    id: "e1",
    deal_id: "d1",
    kind: "comms_sent",
    payload: {
      body: "Dear borrower, please submit your tax returns by Friday or we will close the file.",
      emailBody: "<html><body>SECRET CONTENT HERE</body></html>",
      smsBody: "Your verification code is 123456",
      message_body: "internal slack thread body",
    },
    created_at: "2026-05-14T10:00:00Z",
  }];
  const md = await exp.buildDealTimelineExport("d1", db as any, { format: "markdown" });
  const json = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });
  for (const body of [md.body, json.body]) {
    assert.ok(!body.includes("Dear borrower"), "Must not contain raw message body");
    assert.ok(!body.includes("SECRET CONTENT HERE"), "Must not contain raw email body");
    assert.ok(!body.includes("Your verification code"), "Must not contain raw SMS body");
    assert.ok(!body.includes("internal slack thread body"), "Must not contain raw slack body");
  }
});

test("external storage/provider/webhook URLs are not present in export", async () => {
  const db = new RS();
  db.tables.deal_events = [{
    id: "e1",
    deal_id: "d1",
    kind: "document.uploaded",
    payload: {
      storage_path: "gs://buddy-bucket/secret-path/file.pdf",
      webhook_url: "https://hooks.slack.com/services/T00/B00/xxxxxxxxxxx",
      signed_url: "https://storage.googleapis.com/bucket/file?X-Goog-Signature=abc123xyz",
      s3_url: "https://my-bucket.s3.us-east-1.amazonaws.com/object/path/file.pdf?signed=1",
      azure_url: "https://myaccount.blob.core.windows.net/container/file.pdf?sig=xyz",
    },
    created_at: "2026-05-14T10:00:00Z",
  }];
  const md = await exp.buildDealTimelineExport("d1", db as any, { format: "markdown" });
  const json = await exp.buildDealTimelineExport("d1", db as any, { format: "json" });
  for (const body of [md.body, json.body]) {
    assert.ok(!body.includes("hooks.slack.com"), "Must not contain Slack webhook URL");
    assert.ok(!body.includes("X-Goog-Signature"), "Must not contain signed URL signature");
    assert.ok(!body.includes("storage.googleapis.com/bucket/file"), "Must not contain GCS URL");
    assert.ok(!body.includes("s3.us-east-1.amazonaws.com"), "Must not contain S3 URL");
    assert.ok(!body.includes("blob.core.windows.net"), "Must not contain Azure URL");
    assert.ok(!/gs:\/\/buddy-bucket/.test(body), "Must not contain gs:// path");
  }
});

// ── UI export button preserves filters ─────────────────────────────────────

test("UI export button preserves current filters", () => {
  const src = read("src/app/(app)/deals/[dealId]/_components/BrokerageTimelinePanel.tsx");
  assert.ok(src.includes('data-testid="timeline-export"'), "Must have export button testid");
  assert.ok(src.includes("Export timeline"), "Must show Export timeline label");
  assert.ok(src.includes("buildExportHref"), "Must have buildExportHref helper");
  // Filter state must flow into the export URL
  assert.ok(/categoryFilter\.size > 0/.test(src) && src.includes('"categories"'),
    "Export href must include selected categories");
  assert.ok(/severityFilter\.size > 0/.test(src) && src.includes('"severities"'),
    "Export href must include selected severities");
  assert.ok(/actorFilter\.size > 0/.test(src) && src.includes('"actorTypes"'),
    "Export href must include selected actor types");
  // Default format is markdown
  assert.ok(src.includes('buildExportHref("markdown")'), "Default export must use markdown");
});

// ── No writes / no schema changes ──────────────────────────────────────────

test("export module performs no writes and no schema changes", () => {
  const src = read("src/lib/brokerage/dealTimelineExport.ts");
  assert.ok(!src.includes(".insert("), "Must not insert");
  assert.ok(!src.includes(".update("), "Must not update");
  assert.ok(!src.includes(".delete("), "Must not delete");
  assert.ok(!src.includes(".upsert("), "Must not upsert");
  assert.ok(!src.includes("CREATE TABLE"), "Must not create tables");
  assert.ok(!src.includes("ALTER TABLE"), "Must not alter tables");
});

// ── Single-use type re-export shim (silence unused import warning) ─────────

void tl;
