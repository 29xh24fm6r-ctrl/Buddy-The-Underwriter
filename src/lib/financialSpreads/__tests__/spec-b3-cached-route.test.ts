/**
 * SPEC-B3 — Cached route source-level guards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

test("[spec-b3-v15] cached route returns PDF with staleness header", () => {
  const body = read("src/app/api/deals/[dealId]/classic-spread/cached/route.ts");
  assert.match(body, /x-buddy-classic-pdf-stale/, "Must set staleness header");
  assert.match(body, /x-buddy-classic-pdf-sha256/, "Must set SHA-256 header");
  assert.match(body, /x-buddy-classic-pdf-generated-at/, "Must set generated-at header");
  assert.match(body, /application\/pdf/, "Must set content-type to application/pdf");
});

test("[spec-b3-v16] cached route returns 404 when no cached row exists", () => {
  const body = read("src/app/api/deals/[dealId]/classic-spread/cached/route.ts");
  assert.match(body, /404/, "Must return 404 when no cached PDF");
  assert.match(body, /not_found/, "Must include not_found status");
});

test("[spec-b3-v17] cached route checks staleness against latest fact timestamp", () => {
  const body = read("src/app/api/deals/[dealId]/classic-spread/cached/route.ts");
  assert.match(body, /canonicalFactsTimestamp/, "Must compare canonicalFactsTimestamp");
  assert.match(body, /deal_financial_facts/, "Must query deal_financial_facts for latest timestamp");
});
