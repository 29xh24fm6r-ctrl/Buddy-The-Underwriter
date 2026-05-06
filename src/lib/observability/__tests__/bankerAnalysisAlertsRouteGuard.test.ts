/**
 * Source-level guards for /api/observability/banker-analysis/alerts.
 *
 * Pins the dual-method auth contract:
 *   - GET  → CRON_SECRET only (Vercel cron path; no super-admin fallback)
 *   - POST → CRON_SECRET OR super-admin (manual / operator trigger)
 *
 * Plus the feature-flag short-circuit, dispatch refactor, and the
 * 10-minute cron schedule pin in vercel.json.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ROUTE = "src/app/api/observability/banker-analysis/alerts/route.ts";
const VERCEL = "vercel.json";

const READ = (p: string) => fs.readFileSync(p, "utf-8");

test("route file exists", () => {
  assert.ok(fs.existsSync(ROUTE), `expected route at ${ROUTE}`);
});

test("route exports both GET and POST handlers", () => {
  const src = READ(ROUTE);
  assert.match(
    src,
    /export\s+async\s+function\s+GET\s*\(/,
    "GET handler must exist (Vercel cron invokes GET)",
  );
  assert.match(
    src,
    /export\s+async\s+function\s+POST\s*\(/,
    "POST handler must exist (manual / scripted trigger)",
  );
});

test("GET requires CRON_SECRET via hasValidWorkerSecret", () => {
  const src = READ(ROUTE);
  // Locate the GET handler body and assert it gates on hasValidWorkerSecret.
  const getMatch = src.match(/export\s+async\s+function\s+GET\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(getMatch, "GET handler body must be inspectable");
  const getBody = getMatch![1];
  assert.match(
    getBody,
    /hasValidWorkerSecret\s*\(/,
    "GET must validate CRON_SECRET",
  );
});

test("GET does NOT permit super-admin fallback (cron-only path)", () => {
  const src = READ(ROUTE);
  const getMatch = src.match(/export\s+async\s+function\s+GET\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(getMatch);
  const getBody = getMatch![1];
  assert.doesNotMatch(
    getBody,
    /requireSuperAdmin/,
    "GET must reject browser-driven triggers — no super-admin fallback",
  );
});

test("POST allows CRON_SECRET OR super-admin", () => {
  const src = READ(ROUTE);
  const postMatch = src.match(/export\s+async\s+function\s+POST\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(postMatch);
  const postBody = postMatch![1];
  assert.match(
    postBody,
    /hasValidWorkerSecret\s*\(/,
    "POST must accept CRON_SECRET",
  );
  assert.match(
    postBody,
    /requireSuperAdmin\s*\(/,
    "POST must accept super-admin as fallback",
  );
  // 401 / 403 mapping intact for super-admin failures (file-level — the
  // 401 path may be factored into a shared helper).
  assert.match(src, /status:\s*401/);
  assert.match(postBody, /status:\s*403/);
});

test("route is feature-flagged on BANKER_ANALYSIS_ALERTS_ENABLED", () => {
  const src = READ(ROUTE);
  assert.match(src, /BANKER_ANALYSIS_ALERTS_ENABLED/);
  assert.match(src, /disabled:\s*true/);
});

test("dispatch logic is shared via dispatchBankerAnalysisAlerts (no per-method drift)", () => {
  const src = READ(ROUTE);
  assert.match(
    src,
    /async\s+function\s+dispatchBankerAnalysisAlerts\s*\(/,
    "shared dispatch fn must exist",
  );
  // Both handlers funnel through the shared dispatch
  const getCalls = src.match(/dispatchBankerAnalysisAlerts\s*\(\s*\)/g) ?? [];
  assert.ok(
    getCalls.length >= 2,
    "GET and POST must each call dispatchBankerAnalysisAlerts()",
  );
});

test("dispatch delegates to loadBankerAnalysisSla + sendBankerAnalysisAlert at 24h window", () => {
  const src = READ(ROUTE);
  assert.match(src, /loadBankerAnalysisSla\s*\(/);
  assert.match(src, /sendBankerAnalysisAlert\s*\(/);
  assert.match(src, /windowHours:\s*24/);
});

test("route does NOT read raw analysis tables directly", () => {
  const src = READ(ROUTE);
  for (const banned of [
    "risk_runs",
    "deal_pipeline_ledger",
    "deal_events",
    "buddy_system_events",
  ]) {
    assert.ok(
      !src.includes(banned),
      `route must not reference ${banned} directly`,
    );
  }
});

test("route is server-only and dynamic", () => {
  const src = READ(ROUTE);
  assert.match(src, /import\s+["']server-only["']/);
  assert.match(src, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(src, /export\s+const\s+runtime\s*=\s*["']nodejs["']/);
});

test("vercel.json points the alerts cron at /api/observability/banker-analysis/alerts every 10 minutes", () => {
  const src = READ(VERCEL);
  const json = JSON.parse(src);
  const entry = (json.crons as Array<{ path: string; schedule: string }>).find(
    (c) => c.path === "/api/observability/banker-analysis/alerts",
  );
  assert.ok(entry, "expected alerts cron entry in vercel.json");
  assert.equal(
    entry!.schedule,
    "*/10 * * * *",
    "alerts cron must run every 10 minutes (no faster)",
  );
  // Vercel cron invokes GET — pin the path so it matches the GET handler we ship.
  assert.equal(
    entry!.path,
    "/api/observability/banker-analysis/alerts",
    "cron path must match the route GET handler",
  );
});
