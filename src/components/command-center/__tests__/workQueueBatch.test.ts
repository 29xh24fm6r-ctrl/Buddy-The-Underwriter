/**
 * Phase 14A — Work queue batch-fetch UI contract.
 *
 * Source-level guards over BankerQueueTable + WorkQueueTimelineActivity
 * to ensure the batched-fetch wiring:
 *   - issues ONE request per visible page (not N)
 *   - feeds the result into per-row cells via the `prefetched` prop
 *   - preserves loading/error/fallback states
 *   - does not regress read-only / no-direct-source-access invariants
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cell = require("../WorkQueueTimelineActivity") as typeof import("../WorkQueueTimelineActivity");
const helpers = cell.__internal;

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

const QUEUE_PATH = "src/components/command-center/BankerQueueTable.tsx";
const CELL_PATH = "src/components/command-center/WorkQueueTimelineActivity.tsx";

test("BankerQueueTable issues ONE batched request for visible deal IDs", () => {
  const src = read(QUEUE_PATH);
  assert.ok(src.includes("/api/brokerage/deals/timeline/latest"), "Must call the batch endpoint");
  assert.ok(src.includes("dealIds="), "Must pass dealIds as a query param");
  assert.ok(
    !/\/api\/brokerage\/deals\/\$\{[^}]+\}\/timeline\?limit=1/.test(src),
    "BankerQueueTable must not fan out per-row",
  );
  assert.ok(src.includes("useMemo"), "Must memoize the visible dealIds list");
  assert.ok(src.includes("useEffect"), "Must fetch in useEffect");
});

test("BankerQueueTable caps batched request at 50", () => {
  const src = read(QUEUE_PATH);
  assert.ok(/BATCH_PAGE_SIZE\s*=\s*50/.test(src), "Must define BATCH_PAGE_SIZE = 50");
  assert.ok(src.includes("ordered.length >= BATCH_PAGE_SIZE"), "Must stop adding once cap reached");
});

test("BankerQueueTable dedupes dealIds before batching", () => {
  const src = read(QUEUE_PATH);
  assert.ok(/new Set<string>\(\)/.test(src), "Must dedupe via Set");
  assert.ok(src.includes("seen.has(it.dealId)"), "Must skip already-seen dealIds");
});

test("BankerQueueTable passes prefetched event into WorkQueueTimelineActivity", () => {
  const src = read(QUEUE_PATH);
  assert.ok(src.includes("prefetched="), "Must pass prefetched prop");
  assert.ok(src.includes("latestByDealId[item.dealId]"), "Must look up event by dealId");
  assert.ok(src.includes("fallbackTimestamp={item.latestActivityAt}"), "Must keep legacy timestamp as fallback");
});

test("BankerQueueTable falls back to per-row fetch when batch endpoint fails", () => {
  const src = read(QUEUE_PATH);
  assert.ok(src.includes("batchFailed"), "Must track batch-failed state");
  assert.ok(
    /prefetched=\{batchFailed\s*\?\s*undefined\s*:/.test(src),
    "Must omit prefetched when batch failed",
  );
});

test("WorkQueueTimelineActivity accepts prefetched event and skips per-row fetch", () => {
  const src = read(CELL_PATH);
  assert.ok(src.includes("prefetched?: WorkQueueLatestEvent | null"), "Must declare prefetched prop");
  assert.ok(src.includes("hasPrefetch"), "Must branch on whether prefetched was supplied");
  assert.ok(
    /if \(hasPrefetch\) \{[\s\S]*?return;\s*\}/.test(src),
    "Must early-return out of effect when prefetched is provided",
  );
});

test("WorkQueueTimelineActivity prefetch path renders synchronously (loaded=true on mount)", () => {
  const src = read(CELL_PATH);
  assert.ok(src.includes("useState<boolean>(hasPrefetch)"));
});

test("prefetch path uses the same normalizeEventShape as the API path", () => {
  const goodEvent = { category: "document", severity: "success", title: "Doc uploaded", timestamp: "2026-05-18T12:00:00Z" };
  assert.ok(helpers.normalizeEventShape(goodEvent), "Valid shape must parse");
  for (const bad of [
    null,
    {},
    { category: "alien", severity: "info", title: "x", timestamp: "2026-05-18T00:00:00Z" },
    { category: "document", severity: "fatal", title: "x", timestamp: "2026-05-18T00:00:00Z" },
    { category: "document", severity: "info", title: 42 as any, timestamp: "2026-05-18T00:00:00Z" },
    { category: "document", severity: "info", title: "x", timestamp: 42 as any },
  ] as any[]) {
    assert.equal(helpers.normalizeEventShape(bad), null);
  }
});

test("BankerQueueTable does not access raw source tables", () => {
  const src = read(QUEUE_PATH);
  assert.ok(!src.includes("@/lib/supabase"));
  assert.ok(!src.includes("supabaseAdmin"));
  for (const t of ["deal_events", "deal_pipeline_ledger", "deal_timeline_events", "brokerage_comms_ledger", "brokerage_comms_outbox"]) {
    assert.ok(!src.includes(t), `Queue table must not reference raw table ${t}`);
  }
});

test("BankerQueueTable adds no new writes", () => {
  const src = read(QUEUE_PATH);
  assert.ok(!/method:\s*["']POST["']/i.test(src));
  assert.ok(!/method:\s*["']PUT["']/i.test(src));
  assert.ok(!/method:\s*["']DELETE["']/i.test(src));
  assert.ok(!/method:\s*["']PATCH["']/i.test(src));
  assert.ok(!src.includes(".insert("));
});

test("BankerQueueTable preserves the existing column layout + row actions", () => {
  const src = read(QUEUE_PATH);
  for (const heading of ["Urgency", "Deal", "Stage", "Why", "Blocking", "Primary Action", "Age", "Activity", "Actions"]) {
    const re = new RegExp(`\\b${heading.replace(/ /g, "\\s+")}\\b`);
    assert.ok(re.test(src), `Must keep "${heading}" column`);
  }
  assert.ok(src.includes("BankerQueueRowActions"));
  assert.ok(src.includes("onExecute"));
  assert.ok(src.includes("onAcknowledge"));
  assert.ok(src.includes("onViewActivity"));
});
