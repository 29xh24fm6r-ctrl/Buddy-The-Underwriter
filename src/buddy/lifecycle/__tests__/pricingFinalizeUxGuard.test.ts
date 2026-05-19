/**
 * SPEC-PRICING-FINALIZE-UX-1 CI Guards
 *
 * Asserts that DealPricingClient's "Pricing Not Available Yet" panel:
 *   1. Links to /spreads when financial snapshot is missing
 *   2. Shows a "1–2 minute" wait message and Spreads link when spreads incomplete
 *   3. Links to /underwrite when research is incomplete
 *   4. Auto-reloads every 30s when only spreads block
 *   5. Renders the "Auto-refreshing" countdown when only spreads block
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const CLIENT = "src/app/(app)/deals/[dealId]/pricing/DealPricingClient.tsx";

// ── Guard 1: snapshot-missing branch links to /spreads ───────────────────────

test("Guard 1: financial snapshot missing branch links to Spreads page", () => {
  const src = read(CLIENT);
  // The snapshot block uses snapshotOk; if false it should render a Spreads link.
  assert.match(
    src,
    /Financial snapshot[\s\S]{0,300}?href=\{`\/deals\/\$\{deal\.id\}\/spreads`\}/,
    "snapshot-missing branch must link to /spreads",
  );
});

// ── Guard 2: spreads-incomplete branch has wait copy + Spreads link ──────────

test("Guard 2: spreads-incomplete branch shows '1–2 minutes' copy and Spreads link", () => {
  const src = read(CLIENT);
  assert.match(
    src,
    /1[–-]2 minutes/,
    "spreads-pending message must mention the 1–2 minute typical wait",
  );
  assert.match(
    src,
    /Spread analysis[\s\S]{0,500}?href=\{`\/deals\/\$\{deal\.id\}\/spreads`\}/,
    "spreads-pending branch must link to /spreads",
  );
});

// ── Guard 3: research-pending branch links to /underwrite ────────────────────

test("Guard 3: research-incomplete branch links to Underwriting page", () => {
  const src = read(CLIENT);
  assert.match(
    src,
    /Institutional research[\s\S]{0,300}?href=\{`\/deals\/\$\{deal\.id\}\/underwrite`\}/,
    "research-pending branch must link to /underwrite",
  );
});

// ── Guard 4: auto-refresh useEffect for spreads-only blocking ────────────────

test("Guard 4: useEffect sets 30s setInterval reload when only spreads block", () => {
  const src = read(CLIENT);
  // Verify a useEffect references onlySpreadsBlocking and window.location.reload via setInterval
  assert.match(
    src,
    /useEffect\(\(\) => \{[\s\S]{0,600}?onlySpreadsBlocking[\s\S]{0,400}?setInterval\(\(\) => window\.location\.reload\(\), 30_000\)/,
    "must have a useEffect that runs setInterval(reload, 30s) when only spreads block",
  );
});

// ── Guard 5: countdown line appears when only spreads block ──────────────────

test("Guard 5: countdown 'Auto-refreshing in ~30 seconds' appears when onlySpreadsBlocking", () => {
  const src = read(CLIENT);
  assert.match(
    src,
    /\{onlySpreadsBlocking && \([\s\S]{0,200}?Auto-refreshing in ~30 seconds/,
    "must render the countdown line gated by onlySpreadsBlocking",
  );
});
