/**
 * Source-level guards for /api/deals/[dealId]/analysis-status.
 *
 * The route is intentionally tiny: enforce tenant access via
 * ensureDealBankAccess, then delegate to getDealAnalysisStatus. These guards
 * pin that contract so a future edit can't accidentally reintroduce a
 * tenant-leaking path.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ROUTE = "src/app/api/deals/[dealId]/analysis-status/route.ts";

const READ = (p: string) => fs.readFileSync(p, "utf-8");

test("route file exists", () => {
  assert.ok(fs.existsSync(ROUTE), `expected route file at ${ROUTE}`);
});

test("route imports ensureDealBankAccess and uses it as the auth gate", () => {
  const src = READ(ROUTE);
  assert.match(
    src,
    /from\s+["']@\/lib\/tenant\/ensureDealBankAccess["']/,
    "must import ensureDealBankAccess",
  );
  assert.match(
    src,
    /ensureDealBankAccess\s*\(\s*dealId\s*\)/,
    "must call ensureDealBankAccess(dealId)",
  );
});

test("route returns 401 for unauthorized and 404 otherwise on access failure", () => {
  const src = READ(ROUTE);
  // 401 path conditional on the unauthorized error code
  assert.match(
    src,
    /access\.error\s*===\s*["']unauthorized["']\s*\?\s*401\s*:\s*404/,
    "must map unauthorized → 401 and other access errors → 404",
  );
});

test("route delegates to getDealAnalysisStatus with the access bankId", () => {
  const src = READ(ROUTE);
  assert.match(
    src,
    /from\s+["']@\/lib\/underwriting\/getDealAnalysisStatus["']/,
    "must import getDealAnalysisStatus",
  );
  assert.match(
    src,
    /getDealAnalysisStatus\s*\(\s*\{[^}]*callerBankId\s*:\s*access\.bankId/s,
    "must pass access.bankId as callerBankId",
  );
});

test("route does not import any analysis tables directly (UI contract)", () => {
  const src = READ(ROUTE);
  // The route must never read raw analysis tables itself — only via the helper.
  for (const banned of [
    "risk_runs",
    "memo_runs",
    "memo_sections",
    "deal_decisions",
    "deal_credit_memo_status",
    "deal_reconciliation_results",
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
