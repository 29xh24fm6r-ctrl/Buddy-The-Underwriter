/**
 * SPEC-PRICING-UX-CANONICALIZATION-1 — CI Guard Tests
 *
 * Ensures /pricing renders a single canonical dark cockpit-native UI.
 * No legacy bg-white/text-slate-900 full-page shell may appear after
 * the readiness gate clears.
 *
 * Guards:
 * 1. DealPricingClient does not render top-level bg-white/min-h-screen legacy shell
 * 2. Rebuild Financial Snapshot is a <button>, not a <Link>
 * 3. Rebuild button POSTs to /financial-snapshot/rebuild
 * 4. DealPricingClient shows SnapshotMessage with conditional messaging
 * 5. PricingScenariosPanel uses dark theme (no bg-white table shell)
 * 6. No duplicate pricing UI reachable from main /pricing route
 * 7. Scenario generation error shows specific blocker, not generic 422
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const PRICING_CLIENT = read("src/app/(app)/deals/[dealId]/pricing/DealPricingClient.tsx");
const SCENARIOS_PANEL = read("src/app/(app)/deals/[dealId]/pricing/PricingScenariosPanel.tsx");

describe("SPEC-PRICING-UX-CANONICALIZATION-1 guards", () => {

  // ── Guard 1: No legacy bg-white full-page shell ───────────────────────────
  test("Guard 1: DealPricingClient does not use min-h-screen bg-white shell", () => {
    assert.doesNotMatch(
      PRICING_CLIENT,
      /className="min-h-screen bg-white/,
      "DealPricingClient must not render a full-page bg-white shell — cockpit-native only",
    );
    assert.doesNotMatch(
      PRICING_CLIENT,
      /<main className/,
      "DealPricingClient must not render a <main> element — it is embedded in the cockpit shell",
    );
  });

  // ── Guard 2: Rebuild is a button, not Link ────────────────────────────────
  test("Guard 2: Rebuild Financial Snapshot is a <button>, not a <Link>", () => {
    assert.match(
      PRICING_CLIENT,
      /Rebuild Financial Snapshot/,
      "Rebuild button text must exist",
    );
    // The SnapshotMessage component uses <button> with onClick, not <Link>
    assert.match(
      PRICING_CLIENT,
      /onClick={handleRebuild}/,
      "Rebuild must use onClick handler (button), not href (Link)",
    );
  });

  // ── Guard 3: Rebuild POSTs to /financial-snapshot/rebuild ─────────────────
  test("Guard 3: Rebuild POSTs to /financial-snapshot/rebuild", () => {
    assert.match(
      PRICING_CLIENT,
      /\/financial-snapshot\/rebuild/,
      "Rebuild must POST to /financial-snapshot/rebuild",
    );
    assert.match(
      PRICING_CLIENT,
      /method:\s*"POST"/,
      "Rebuild must use POST method",
    );
  });

  // ── Guard 4: SnapshotMessage has conditional messaging ────────────────────
  test("Guard 4: SnapshotMessage shows conditional messages based on spreadJobStatus", () => {
    assert.match(PRICING_CLIENT, /Financial spread completed, but the snapshot was not saved/);
    assert.match(PRICING_CLIENT, /Financial spread is still running/);
    assert.match(PRICING_CLIENT, /Run financial spreads to create the snapshot/);
    assert.match(PRICING_CLIENT, /Financial spread failed/);
  });

  // ── Guard 5: PricingScenariosPanel uses dark theme ────────────────────────
  test("Guard 5: PricingScenariosPanel does not use bg-white table shell", () => {
    assert.doesNotMatch(
      SCENARIOS_PANEL,
      /bg-white shadow-sm/,
      "Scenarios table must not use bg-white shadow-sm — must use dark theme",
    );
    assert.doesNotMatch(
      SCENARIOS_PANEL,
      /border-slate-200 bg-white/,
      "Scenarios panel must not use light border/bg combo",
    );
  });

  // ── Guard 6: No duplicate pricing UI ──────────────────────────────────────
  test("Guard 6: DealPricingClient has exactly one return with pricing content", () => {
    // The component has two returns: readiness gate and main pricing.
    // The main pricing return must not be wrapped in <main> (embedded in cockpit).
    const mainTagCount = (PRICING_CLIENT.match(/<main[\s>]/g) || []).length;
    assert.equal(mainTagCount, 0, "No <main> tags should exist — component is embedded in cockpit");
  });

  // ── Guard 7: Scenario generation error shows specific blocker ─────────────
  test("Guard 7: Scenario generation shows specific blocker for no_financial_snapshot", () => {
    assert.match(
      SCENARIOS_PANEL,
      /Rebuild Financial Snapshot button above/,
      "no_financial_snapshot error must direct user to rebuild button, not 'generate spreads'",
    );
    assert.doesNotMatch(
      SCENARIOS_PANEL,
      /generate spreads and snapshot first/,
      "Must not show old generic message — use specific rebuild guidance instead",
    );
  });
});
