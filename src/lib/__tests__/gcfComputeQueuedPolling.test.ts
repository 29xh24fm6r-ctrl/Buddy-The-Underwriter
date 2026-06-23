import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-GCF-COMPUTE-QUEUED-POLLING-AND-STATUS-1 regression guard.
 *
 * Clicking Compute enqueues a GLOBAL_CASH_FLOW row with status="queued" and
 * owner_type="GLOBAL". The page used to treat only status==="generating" as
 * active work, so it neither polled nor showed progress and fell back to
 * "No global cash flow analysis yet" — even with a queued job in flight, and
 * even when a stale legacy DEAL-owned ready row existed.
 *
 * deal_spreads status lifecycle: queued → generating → ready | error.
 * Canonical owner_type for GLOBAL_CASH_FLOW is GLOBAL (resolveOwnerType).
 */

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const PAGE = "src/app/(app)/deals/[dealId]/spreads/global-cash-flow/page.tsx";
const SPREADS_ROUTE = "src/app/api/deals/[dealId]/spreads/route.ts";

test("both queued and generating are treated as active compute states", () => {
  const src = read(PAGE);
  assert.ok(
    /ACTIVE_STATUSES\s*=\s*new Set\(\["queued",\s*"generating"\]\)/.test(src),
    "must treat queued AND generating as active",
  );
  assert.ok(
    !/\.some\(\(s\)\s*=>\s*s\.status === "generating"\)/.test(src),
    "must not poll on generating-only (queued would be ignored)",
  );
});

test("polling continues while any GCF row is queued or generating", () => {
  const src = read(PAGE);
  // The poll effect is gated on isActiveSpread, which covers queued+generating.
  assert.ok(
    /spreads\.some\(isActiveSpread\)/.test(src),
    "poll effect must key off isActiveSpread (queued|generating)",
  );
  assert.ok(
    /setInterval\(\(\)\s*=>\s*void load\(\)/.test(src),
    "must poll by reloading on an interval",
  );
});

test("row selection is canonical, not blind spreads[0]", () => {
  const src = read(PAGE);
  assert.ok(
    !/spreads\[0\]/.test(src),
    "must not blindly select spreads[0] (could be a queued GLOBAL or stale DEAL row)",
  );
  assert.ok(
    /\.filter\(hasGcfValue\)/.test(src),
    "ready row must be chosen from rows that actually carry a GCF value",
  );
  assert.ok(
    /owner_type === "GLOBAL"/.test(src),
    "selection must prefer the canonical GLOBAL owner_type",
  );
});

test("never falls back to the old empty 'No analysis yet' dead-end", () => {
  const src = read(PAGE);
  assert.ok(
    !/No global cash flow analysis yet/.test(src),
    "the empty dead-end string must be gone — replaced by an explicit state machine",
  );
  // Explicit view states exist.
  for (const v of ["computing", "ready", "error", "missing"]) {
    assert.ok(
      new RegExp(`view === "${v}"`).test(src),
      `must render an explicit "${v}" view`,
    );
  }
  assert.ok(
    /Computing Global Cash Flow…/.test(src),
    "computing view must show a Computing… status",
  );
});

test("error view surfaces real spread diagnostics", () => {
  const src = read(PAGE);
  assert.ok(/errorSpread/.test(src), "must select the failed spread row");
  assert.ok(
    /error_code/.test(src) && /error_details_json/.test(src),
    "error view must render error_code and error_details_json when available",
  );
});

test("spreads API returns the error diagnostics columns", () => {
  const src = read(SPREADS_ROUTE);
  assert.ok(
    /error_code/.test(src) && /error_details_json/.test(src),
    "GET /spreads must select error_code and error_details_json",
  );
});
