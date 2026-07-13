import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

/**
 * Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md (round 4,
 * "learn from failure"): getActiveCooldownDomains() is what lets
 * runMission.ts skip a source domain that just failed instead of wasting
 * another network call repeating the same failure.
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { getActiveCooldownDomains, mapBIEErrorTypeToFailureCategory } =
  require_("@/lib/research/failureLibrary") as typeof import("@/lib/research/failureLibrary");

function fakeSb(rows: Array<{ source_domain: string | null; cooldown_seconds: number | null; last_seen_at: string }>) {
  return {
    from: () => ({
      select: () => ({
        in: () => ({
          not: () => ({
            not: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  } as any;
}

test("a domain within its cooldown window is returned", async () => {
  const sb = fakeSb([
    { source_domain: "example.com", cooldown_seconds: 3600, last_seen_at: new Date().toISOString() },
  ]);
  const cooling = await getActiveCooldownDomains(sb);
  assert.ok(cooling.has("example.com"));
});

test("a domain whose cooldown has already elapsed is NOT returned", async () => {
  const sb = fakeSb([
    { source_domain: "stale.com", cooldown_seconds: 60, last_seen_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
  ]);
  const cooling = await getActiveCooldownDomains(sb);
  assert.ok(!cooling.has("stale.com"));
});

test("rows missing a domain or cooldown_seconds are skipped, not crashed on", async () => {
  const sb = fakeSb([
    { source_domain: null, cooldown_seconds: 3600, last_seen_at: new Date().toISOString() },
    { source_domain: "no-cooldown.com", cooldown_seconds: null, last_seen_at: new Date().toISOString() },
  ]);
  const cooling = await getActiveCooldownDomains(sb);
  assert.equal(cooling.size, 0);
});

test("mapBIEErrorTypeToFailureCategory: http 429 -> rate_limited, 5xx -> source_unavailable, 404 -> model_error", () => {
  assert.equal(mapBIEErrorTypeToFailureCategory("http_error", 429), "rate_limited");
  assert.equal(mapBIEErrorTypeToFailureCategory("http_error", 503), "source_unavailable");
  assert.equal(mapBIEErrorTypeToFailureCategory("http_error", 404), "model_error");
  assert.equal(mapBIEErrorTypeToFailureCategory("http_error", 401), "auth_expired");
});

test("mapBIEErrorTypeToFailureCategory: structured categories don't need message parsing", () => {
  assert.equal(mapBIEErrorTypeToFailureCategory("json_parse_error"), "schema_mismatch");
  assert.equal(mapBIEErrorTypeToFailureCategory("safety_block"), "model_error");
  assert.equal(mapBIEErrorTypeToFailureCategory("empty_candidate"), "model_error");
});
