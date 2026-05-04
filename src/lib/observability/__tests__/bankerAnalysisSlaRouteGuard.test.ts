/**
 * Source-level guards for /api/observability/banker-analysis.
 *
 * Pins the route's auth contract and delegation pattern so a future edit
 * can't accidentally drop super-admin enforcement or start reading raw
 * tables instead of going through the aggregator.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ROUTE = "src/app/api/observability/banker-analysis/route.ts";
const READ = (p: string) => fs.readFileSync(p, "utf-8");

test("route file exists", () => {
  assert.ok(fs.existsSync(ROUTE), `expected route at ${ROUTE}`);
});

test("route enforces requireSuperAdmin and maps unauthorized/forbidden to 401/403", () => {
  const src = READ(ROUTE);
  assert.match(src, /from\s+["']@\/lib\/auth\/requireAdmin["']/);
  assert.match(src, /requireSuperAdmin\s*\(\s*\)/);
  assert.match(src, /["']unauthorized["'][^,]*,\s*\{[^}]*status:\s*401/);
  assert.match(src, /["']forbidden["'][^,]*,\s*\{[^}]*status:\s*403/);
});

test("route delegates to loadBankerAnalysisSla and never reads raw tables directly", () => {
  const src = READ(ROUTE);
  assert.match(
    src,
    /from\s+["']@\/lib\/observability\/bankerAnalysisSla["']/,
  );
  assert.match(src, /loadBankerAnalysisSla\s*\(/);
  for (const banned of [
    "risk_runs",
    "deal_pipeline_ledger",
    "deal_events",
    "memo_runs",
    "deal_decisions",
  ]) {
    assert.ok(
      !src.includes(banned),
      `route must not reference ${banned} directly`,
    );
  }
});

test("route is server-only, dynamic, and parses windowHours from query string", () => {
  const src = READ(ROUTE);
  assert.match(src, /import\s+["']server-only["']/);
  assert.match(src, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(src, /export\s+const\s+runtime\s*=\s*["']nodejs["']/);
  assert.match(src, /windowHours/);
});
