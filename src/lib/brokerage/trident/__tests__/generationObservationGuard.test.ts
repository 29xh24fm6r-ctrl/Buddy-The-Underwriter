import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const route = readFileSync(
  resolve(root, "src/app/api/brokerage/deals/[dealId]/trident/generate/route.ts"),
  "utf8",
);
const client = readFileSync(
  resolve(root, "src/components/brokerage/GoldenTridentLabClient.tsx"),
  "utf8",
);

test("generation status reads are bound to the exact accepted bundle", () => {
  assert.match(route, /searchParams\.get\("bundleId"\)/);
  assert.match(route, /\.eq\("id", requestedBundleId\)/);
  assert.match(route, /invalid_bundle_id/);
  assert.match(route, /bundle_not_found/);

  assert.match(
    client,
    /bundleId=\$\{encodeURIComponent\(bundleId\)\}/,
    "the client must observe the bundle returned by POST, not whichever final run is latest",
  );
  assert.doesNotMatch(
    client,
    /body\.bundle\?\.id !== bundleId\) continue/,
    "a different bundle must fail explicitly instead of polling the wrong run until timeout",
  );
});

test("generation polling backs off, bounds slow requests, and suspends while hidden", () => {
  assert.match(client, /TRIDENT_POLL_MAX_MS\s*=\s*30_000/);
  assert.match(client, /Math\.ceil\(pollDelayMs \* 1\.5\)/);
  assert.match(client, /TRIDENT_POLL_REQUEST_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /document\.visibilityState/);
  assert.match(client, /visibilitychange/);
  assert.doesNotMatch(
    client,
    /setTimeout\(resolve,\s*5000\)/,
    "fixed five-second polling recreates the production request storm",
  );
});
