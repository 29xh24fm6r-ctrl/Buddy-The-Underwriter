/**
 * Source-level guards for /api/observability/banker-analysis/alerts.
 *
 * Pins the route's auth contract, feature-flag short-circuit, and dispatch
 * delegation so a future edit can't drop these properties silently.
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

test("route requires CRON_SECRET (hasValidWorkerSecret) OR super-admin", () => {
  const src = READ(ROUTE);
  assert.match(src, /from\s+["']@\/lib\/auth\/hasValidWorkerSecret["']/);
  assert.match(src, /hasValidWorkerSecret\s*\(/);
  assert.match(src, /from\s+["']@\/lib\/auth\/requireAdmin["']/);
  assert.match(src, /requireSuperAdmin\s*\(/);
  // 401 / 403 mapping intact
  assert.match(src, /["']unauthorized["'][^,]*,\s*\{[^}]*status:\s*401/);
  assert.match(src, /["']forbidden["'][^,]*,\s*\{[^}]*status:\s*403/);
});

test("route is feature-flagged on BANKER_ANALYSIS_ALERTS_ENABLED", () => {
  const src = READ(ROUTE);
  assert.match(src, /BANKER_ANALYSIS_ALERTS_ENABLED/);
  // Returns disabled:true when off — short-circuit before doing any work
  assert.match(src, /disabled:\s*true/);
});

test("route delegates to loadBankerAnalysisSla and sendBankerAnalysisAlert", () => {
  const src = READ(ROUTE);
  assert.match(src, /loadBankerAnalysisSla\s*\(/);
  assert.match(src, /sendBankerAnalysisAlert\s*\(/);
  // Window is fixed at 24h per the spec
  assert.match(src, /windowHours:\s*24/);
});

test("route does NOT read raw analysis tables directly (UI / observability contract)", () => {
  const src = READ(ROUTE);
  for (const banned of [
    "risk_runs",
    "deal_pipeline_ledger",
    "deal_events",
    "buddy_system_events",
  ]) {
    assert.ok(
      !src.includes(banned),
      `route must not reference ${banned} directly — go through helpers`,
    );
  }
});

test("route is server-only, dynamic, POST-only", () => {
  const src = READ(ROUTE);
  assert.match(src, /import\s+["']server-only["']/);
  assert.match(src, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(src, /export\s+const\s+runtime\s*=\s*["']nodejs["']/);
  assert.match(src, /export\s+async\s+function\s+POST\s*\(/);
  assert.doesNotMatch(
    src,
    /export\s+async\s+function\s+GET\s*\(/,
    "POST-only — GET would let the cron be triggered without auth via browser",
  );
});

test("vercel.json has the alerts cron at every-10-min cadence (no faster)", () => {
  const src = READ(VERCEL);
  const json = JSON.parse(src);
  const entry = (json.crons as Array<{ path: string; schedule: string }>).find(
    (c) => c.path === "/api/observability/banker-analysis/alerts",
  );
  assert.ok(entry, "expected alerts cron entry in vercel.json");
  assert.equal(entry!.schedule, "*/10 * * * *", "alerts cron must run every 10 minutes (no faster)");
});
