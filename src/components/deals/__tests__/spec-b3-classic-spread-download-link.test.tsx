/**
 * SPEC-B3 — ClassicSpreadDownloadLink source-level guards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

test("[spec-b3-v21] ClassicSpreadDownloadLink tries cached endpoint first", () => {
  const body = read("src/components/deals/ClassicSpreadDownloadLink.tsx");
  assert.match(body, /classic-spread\/cached/, "Must try /cached endpoint");
  // The sync fallback uses template literal: /classic-spread`
  assert.match(body, /classic-spread`\)/, "Must fall back to sync route");

  // Verify cached comes before sync fallback
  const cachedIdx = body.indexOf("classic-spread/cached");
  const syncFallbackIdx = body.indexOf("/classic-spread`)", cachedIdx + 1);
  assert.ok(syncFallbackIdx > cachedIdx, "Cached endpoint must be tried before sync fallback");
});

test("[spec-b3-v22] ClassicSpreadDownloadLink fires /ensure on mount", () => {
  const body = read("src/components/deals/ClassicSpreadDownloadLink.tsx");
  assert.match(body, /classic-spread\/ensure/, "Must call /ensure endpoint");
  assert.match(body, /useEffect/, "Must fire ensure in useEffect (on mount)");
  assert.match(body, /method:\s*"POST"/, "Must use POST method for /ensure");
});

test("[spec-b3-v23] SpreadOutputPanel uses ClassicSpreadDownloadLink", () => {
  const body = read("src/components/deals/cockpit/panels/spread/SpreadOutputPanel.tsx");
  assert.match(body, /ClassicSpreadDownloadLink/, "Must import and use ClassicSpreadDownloadLink");
  // Verify the old inline handler is removed
  const stripped = body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !stripped.includes("handleClassicExport"),
    "Old handleClassicExport handler must be removed",
  );
});
