/**
 * SPEC-FINANCIAL-SNAPSHOT-HANDOFF-FIX-2 — CI Guard Tests
 *
 * Locks the canonical handoff:
 *   spread job SUCCEEDED → financial_snapshots persisted → lifecycle gate → pricing
 *
 * Guards:
 * 1. spreadsProcessor persists financial snapshot on job success
 * 2. /spread-output self-heals missing financial_snapshots (fallback)
 * 3. deriveLifecycleState reads financialSnapshotExists from financial_snapshots
 * 4. pricing page does not send user to Spreads when spread job already succeeded
 * 5. pricing page passes spreadJobStatus to DealPricingClient
 * 6. DealPricingClient shows "Rebuild Financial Snapshot" when spread succeeded but snapshot missing
 * 7. /api/deals/[dealId]/financial-snapshot/rebuild endpoint exists
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const SPREADS_PROCESSOR = read("src/lib/jobs/processors/spreadsProcessor.ts");
const SPREAD_OUTPUT = read("src/app/api/deals/[dealId]/spread-output/route.ts");
const DERIVE_LIFECYCLE = read("src/buddy/lifecycle/deriveLifecycleState.ts");
const PRICING_PAGE = read("src/app/(app)/deals/[dealId]/pricing/page.tsx");
const PRICING_CLIENT = read("src/app/(app)/deals/[dealId]/pricing/DealPricingClient.tsx");

describe("SPEC-FINANCIAL-SNAPSHOT-HANDOFF-FIX-2 guards", () => {

  // ── Guard 1: spreadsProcessor persists snapshot on job success ─────────────
  test("Guard 1: spreadsProcessor calls persistFinancialSnapshot after spread job success", () => {
    assert.match(
      SPREADS_PROCESSOR,
      /persistFinancialSnapshot/,
      "spreadsProcessor must call persistFinancialSnapshot",
    );
    assert.match(
      SPREADS_PROCESSOR,
      /buildDealFinancialSnapshotForBank/,
      "spreadsProcessor must call buildDealFinancialSnapshotForBank",
    );
    assert.match(
      SPREADS_PROCESSOR,
      /financial_snapshot\.persisted/,
      "spreadsProcessor must emit financial_snapshot.persisted ledger event on success",
    );
    assert.match(
      SPREADS_PROCESSOR,
      /financial_snapshot\.persist_failed/,
      "spreadsProcessor must emit financial_snapshot.persist_failed ledger event on failure",
    );
  });

  // ── Guard 2: /spread-output self-heals as fallback ────────────────────────
  test("Guard 2: spread-output self-heals missing financial_snapshots (fallback writer)", () => {
    assert.match(
      SPREAD_OUTPUT,
      /persistFinancialSnapshot/,
      "spread-output must call persistFinancialSnapshot as fallback",
    );
    assert.match(
      SPREAD_OUTPUT,
      /snapshotWarning/,
      "spread-output must surface snapshotWarning when persistence fails",
    );
  });

  // ── Guard 3: deriveLifecycleState reads from financial_snapshots ──────────
  test("Guard 3: deriveLifecycleState counts financial_snapshots for financialSnapshotExists", () => {
    assert.match(
      DERIVE_LIFECYCLE,
      /from\("financial_snapshots"\)/,
      "deriveLifecycleState must query financial_snapshots",
    );
    assert.match(
      DERIVE_LIFECYCLE,
      /financialSnapshotExists/,
      "deriveLifecycleState must set financialSnapshotExists",
    );
  });

  // ── Guard 4: pricing page queries spread job status ───────────────────────
  test("Guard 4: pricing page queries deal_spread_jobs status when not ready", () => {
    assert.match(
      PRICING_PAGE,
      /deal_spread_jobs/,
      "pricing page must query deal_spread_jobs to determine spread job state",
    );
    assert.match(
      PRICING_PAGE,
      /spreadJobStatus/,
      "pricing page must derive spreadJobStatus from job query",
    );
  });

  // ── Guard 5: pricing page passes spreadJobStatus to DealPricingClient ─────
  test("Guard 5: pricing page passes spreadJobStatus in readinessInfo", () => {
    assert.match(
      PRICING_PAGE,
      /spreadJobStatus/,
      "pricing page must pass spreadJobStatus to DealPricingClient readinessInfo",
    );
  });

  // ── Guard 6: DealPricingClient shows Rebuild button when spread succeeded ─
  test("Guard 6: DealPricingClient shows 'Rebuild Financial Snapshot' when spread succeeded but snapshot missing", () => {
    assert.match(
      PRICING_CLIENT,
      /Rebuild Financial Snapshot/,
      "DealPricingClient must show Rebuild button text",
    );
    assert.match(
      PRICING_CLIENT,
      /financial-snapshot\/rebuild/,
      "DealPricingClient must call /financial-snapshot/rebuild endpoint",
    );
    assert.match(
      PRICING_CLIENT,
      /spreadJobStatus/,
      "DealPricingClient ReadinessInfo must include spreadJobStatus",
    );
    // Conditional messages per spec
    assert.match(
      PRICING_CLIENT,
      /Financial spread completed, but the snapshot was not saved/,
      "Must show 'snapshot was not saved' when spread succeeded but snapshot missing",
    );
    assert.match(
      PRICING_CLIENT,
      /Financial spread is still running/,
      "Must show 'still running' when spread job is running",
    );
    assert.match(
      PRICING_CLIENT,
      /Run financial spreads to create the snapshot/,
      "Must show 'run spreads' when no spread job exists",
    );
    assert.match(
      PRICING_CLIENT,
      /Financial spread failed/,
      "Must show 'spread failed' when spread job failed",
    );
  });

  // ── Guard 7: /financial-snapshot/rebuild endpoint exists ───────────────────
  test("Guard 7: /api/deals/[dealId]/financial-snapshot/rebuild route exists", () => {
    const routePath = resolve(
      repoRoot,
      "src/app/api/deals/[dealId]/financial-snapshot/rebuild/route.ts",
    );
    assert.ok(
      existsSync(routePath),
      "rebuild route must exist at src/app/api/deals/[dealId]/financial-snapshot/rebuild/route.ts",
    );
    const src = read("src/app/api/deals/[dealId]/financial-snapshot/rebuild/route.ts");
    assert.match(src, /persistFinancialSnapshot/, "rebuild route must persist snapshot");
    assert.match(src, /buildDealFinancialSnapshotForBank/, "rebuild route must build snapshot from facts");
    assert.match(src, /recomputeDealReady/, "rebuild route must recompute readiness after persist");
  });
});
