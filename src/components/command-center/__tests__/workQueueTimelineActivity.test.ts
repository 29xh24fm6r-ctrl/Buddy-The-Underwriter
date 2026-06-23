/**
 * Phase 13E — Work queue timeline activity tests.
 *
 * Behavioral tests over the exposed __internal helpers + source-level
 * guards over the component contract. We do not mount the React tree
 * because this repo's test runner is `node --test` without JSDOM; the
 * source guards lock the contract that DOM rendering would otherwise
 * cover.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Strip the "use client" directive + react imports + JSX block so the helpers
// can be loaded by node --test without a JSX runtime. We require the file via
// createRequire and tsx handles the rest — but only the non-JSX exports
// matter here, and tsx + esbuild understand tsx out of the box.
const cell = require("../WorkQueueTimelineActivity") as typeof import("../WorkQueueTimelineActivity");
const helpers = cell.__internal;

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// ── Behavior: parseLatestEvent / shortenTitle / formatRelativeTime ─────────

test("renders latest activity per deal (parseLatestEvent extracts category+severity+title+timestamp)", () => {
  const payload = {
    ok: true,
    count: 1,
    events: [
      {
        id: "e1",
        dealId: "d1",
        category: "document",
        severity: "success",
        title: "Document uploaded",
        description: "File: tax_return.pdf",
        timestamp: "2026-05-18T12:00:00Z",
        actorType: "borrower",
        metadataSafe: {},
        href: "/deals/d1#document-doc-1",
      },
    ],
  };
  const parsed = helpers.parseLatestEvent(payload);
  assert.ok(parsed, "Must parse a valid latest event");
  assert.equal(parsed!.category, "document");
  assert.equal(parsed!.severity, "success");
  assert.equal(parsed!.title, "Document uploaded");
  assert.equal(parsed!.timestamp, "2026-05-18T12:00:00Z");
});

test("parseLatestEvent rejects malformed / unknown / missing payloads", () => {
  assert.equal(helpers.parseLatestEvent(null), null);
  assert.equal(helpers.parseLatestEvent({}), null);
  assert.equal(helpers.parseLatestEvent({ events: [] }), null);
  assert.equal(helpers.parseLatestEvent({ events: "nope" }), null);
  // Unknown category/severity must be rejected (defense against UI drift)
  assert.equal(
    helpers.parseLatestEvent({
      events: [{ category: "alien", severity: "info", title: "x", timestamp: "2026-05-18T00:00:00Z" }],
    }),
    null,
  );
  assert.equal(
    helpers.parseLatestEvent({
      events: [{ category: "document", severity: "fatal", title: "x", timestamp: "2026-05-18T00:00:00Z" }],
    }),
    null,
  );
});

test("shortenTitle truncates long titles with ellipsis", () => {
  assert.equal(helpers.shortenTitle("short"), "short");
  const long = "This is a very long activity title that exceeds the maximum length allowed in the queue cell";
  const out = helpers.shortenTitle(long);
  assert.ok(out.length <= 36, `Truncated must be ≤ 36 chars: ${out.length}`);
  assert.ok(out.endsWith("…"), "Truncated must end with ellipsis");
});

test("formatRelativeTime handles null and bad input gracefully", () => {
  assert.equal(helpers.formatRelativeTime(null), "—");
  assert.equal(helpers.formatRelativeTime("not-a-date"), "—");
});

// ── Source contract: redaction + safety ────────────────────────────────────

const COMPONENT_PATH = "src/components/command-center/WorkQueueTimelineActivity.tsx";

test("masks recipients — component never accesses or renders the 'recipient' field", () => {
  const src = read(COMPONENT_PATH);
  assert.ok(!/\brecipient\b/.test(src), "Component must not reference 'recipient' field");
  assert.ok(!/recipientMasked/.test(src), "Component must not even read recipientMasked (description carries masked form already)");
});

test("redacts secrets — component does not bypass timeline API redaction", () => {
  const src = read(COMPONENT_PATH);
  // Component uses only normalized API fields. The full whitelist of fields it touches:
  for (const banned of ["RESEND_API_KEY", "TELNYX_API_KEY", "Bearer ", "re_", "rawToken", "secret_key"]) {
    assert.ok(!src.includes(banned), `Component must not contain ${banned}`);
  }
  // Component must NOT call Supabase / DB directly
  assert.ok(!src.includes("@/lib/supabase"), "Component must not import supabase");
  assert.ok(!src.includes("supabaseAdmin"), "Component must not call supabaseAdmin");
  assert.ok(!src.includes("from \"@supabase"), "Component must not import @supabase");
});

test("links to deal timeline anchor", () => {
  const src = read(COMPONENT_PATH);
  assert.ok(/`\/deals\/\$\{dealId\}#timeline`/.test(src), "Must link to /deals/{dealId}#timeline");
  assert.ok(src.includes('href={href}') || src.includes("href={\`/deals/"), "Must use Link with that href");
});

test("no raw message bodies — component never reads body fields", () => {
  const raw = read(COMPONENT_PATH);
  // Strip comments — doc-string descriptions of what the component does NOT do
  // would otherwise trip the literal search.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const bodyKey of ["body", "emailBody", "smsBody", "slackBody", "message_body"]) {
    const re = new RegExp(`\\b${bodyKey}\\b`);
    assert.ok(!re.test(src), `Component must not reference ${bodyKey} field`);
  }
});

test("uses existing timeline aggregation API (not raw source tables)", () => {
  const src = read(COMPONENT_PATH);
  assert.ok(src.includes("/api/brokerage/deals/"), "Must call the timeline API");
  assert.ok(src.includes("/timeline?limit=1"), "Must request limit=1");
  // No direct table references
  for (const table of ["deal_events", "deal_pipeline_ledger", "deal_timeline_events", "brokerage_comms_ledger", "brokerage_comms_outbox"]) {
    assert.ok(!src.includes(table), `Component must not reference raw table ${table}`);
  }
});

test("empty state renders 'No recent activity.'", () => {
  const src = read(COMPONENT_PATH);
  assert.ok(src.includes("No recent activity."), "Must show 'No recent activity.' empty state");
  assert.ok(src.includes('data-testid="work-queue-timeline-activity-empty"'), "Must mark empty state with testid");
});

// ── No writes / no schema changes ──────────────────────────────────────────

test("component performs no writes and adds no schema changes", () => {
  const src = read(COMPONENT_PATH);
  assert.ok(!/method:\s*["']POST["']/i.test(src), "Component must not POST");
  assert.ok(!/method:\s*["']PUT["']/i.test(src), "Component must not PUT");
  assert.ok(!/method:\s*["']DELETE["']/i.test(src), "Component must not DELETE");
  assert.ok(!/method:\s*["']PATCH["']/i.test(src), "Component must not PATCH");
  assert.ok(!src.includes(".insert("), "Component must not insert");
  assert.ok(!src.includes(".update("), "Component must not update");
  assert.ok(!src.includes(".delete("), "Component must not delete");
});

// ── Work queue behavior unchanged ──────────────────────────────────────────

const QUEUE_PATH = "src/components/command-center/BankerQueueTable.tsx";

test("work queue behavior unchanged — all existing columns + actions intact", () => {
  const src = read(QUEUE_PATH);

  // Existing column headers
  for (const heading of ["Urgency", "Deal", "Stage", "Why", "Blocking", "Primary Action", "Age", "Activity", "Actions"]) {
    assert.ok(src.includes(`>\n              ${heading}`) || src.includes(`>${heading}`), `Must keep "${heading}" column`);
  }

  // Row-level surfaces still present
  assert.ok(src.includes("BankerQueueRowActions"), "Row actions still rendered");
  assert.ok(src.includes("item.urgencyBucket"), "Urgency badge still rendered");
  assert.ok(src.includes("item.queueReasonLabel"), "Queue reason still rendered");
  assert.ok(src.includes("item.primaryActionLabel"), "Primary action still rendered");
  assert.ok(src.includes("item.primaryActionAgeHours"), "Age still rendered");
  assert.ok(src.includes("item.changedSinceViewed"), "Changed indicator still rendered");

  // Activity cell now uses the new component but still passes the legacy
  // latestActivityAt as fallback so the cell never regresses to empty.
  assert.ok(src.includes("WorkQueueTimelineActivity"), "Activity cell wired to new component");
  assert.ok(src.includes("fallbackTimestamp={item.latestActivityAt}"), "Must pass legacy timestamp as fallback");
  assert.ok(src.includes("dealId={item.dealId}"), "Must pass dealId");

  // No new writes / no new mutating handlers introduced in the queue table
  assert.ok(!/method:\s*["']POST["']/i.test(src), "Queue table must not POST");
  assert.ok(!src.includes(".insert("), "Queue table must not insert");
});
