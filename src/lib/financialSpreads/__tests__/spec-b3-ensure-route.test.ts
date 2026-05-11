/**
 * SPEC-B3 — Ensure route source-level guards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

test("[spec-b3-v18] ensure route is POST (side-effect: enqueues job)", () => {
  const body = read("src/app/api/deals/[dealId]/classic-spread/ensure/route.ts");
  assert.match(body, /export async function POST/, "Must export POST handler (not GET)");
});

test("[spec-b3-v19] ensure route returns cached/enqueued/generating status", () => {
  const body = read("src/app/api/deals/[dealId]/classic-spread/ensure/route.ts");
  assert.match(body, /"cached"/, "Must return cached status when fresh cache exists");
  assert.match(body, /"enqueued"/, "Must return enqueued status when job is created");
  assert.match(body, /"generating"/, "Must return generating status when job already in progress");
});

test("[spec-b3-v20] ensure route enqueues CLASSIC_PDF via enqueueSpreadRecompute", () => {
  const body = read("src/app/api/deals/[dealId]/classic-spread/ensure/route.ts");
  assert.match(body, /enqueueSpreadRecompute/, "Must use enqueueSpreadRecompute");
  assert.match(body, /CLASSIC_PDF/, "Must enqueue CLASSIC_PDF type");
});
