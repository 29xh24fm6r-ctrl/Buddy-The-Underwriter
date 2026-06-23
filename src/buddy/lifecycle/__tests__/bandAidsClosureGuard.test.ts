/**
 * SPEC-BAND-AIDS-CLOSURE-1 CI Guards
 *
 * Invariants for the three band-aid closures:
 *   Fix 1: MemoInputReadinessPanel blocker label has explicit text color
 *   Fix 2a: deriveLifecycleState filters stale spread jobs and excludes FAILED
 *   Fix 2b: pricing/quote route returns human-readable message on 422
 *   Fix 2b: DealPricingClient handleQuote prefers json.message
 *   Fix 3:  refreshQuotes falls back to window.location.reload() on non-ok
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

// ── Guard 1: MemoInputReadinessPanel blocker label has text-gray-900 ─────────

test("Guard 1: MemoInputReadinessPanel blocker label span uses text-gray-900", () => {
  const src = read("src/components/creditMemo/inputs/MemoInputReadinessPanel.tsx");
  assert.match(
    src,
    /<span className="flex-1 text-gray-900">\s*\n?\s*\{b\.label\}/,
    "blocker label span must include text-gray-900 — otherwise label is invisible on amber background",
  );
});

// ── Guard 2a: deriveLifecycleState spread jobs gate has age filter ───────────

test("Guard 2a: deriveLifecycleState spread jobs query filters created_at >= now-30min", () => {
  const src = read("src/buddy/lifecycle/deriveLifecycleState.ts");
  assert.match(
    src,
    /\.from\("deal_spread_jobs"\)[\s\S]{0,400}?\.gte\(\s*"created_at"/,
    "spread jobs gate must filter by created_at to avoid permanent block from stale jobs",
  );
  assert.match(
    src,
    /30\s*\*\s*60\s*\*\s*1000/,
    "spread jobs gate must use a 30-minute staleness window",
  );
});

test("Guard 2b: deriveLifecycleState spread jobs gate excludes FAILED status", () => {
  const src = read("src/buddy/lifecycle/deriveLifecycleState.ts");
  // Find the deal_spread_jobs block specifically (not the document_artifacts one)
  const match = src.match(
    /\.from\("deal_spread_jobs"\)[\s\S]{0,400}?\.in\("status",\s*\[([^\]]+)\]\)/,
  );
  assert.ok(match, "must find the deal_spread_jobs .in(status,...) call");
  const statusList = match![1];
  assert.doesNotMatch(
    statusList,
    /FAILED/,
    "spread jobs gate must NOT count FAILED as blocking — failures are warnings, not hard gates",
  );
  assert.match(statusList, /QUEUED/, "spread jobs gate still counts QUEUED");
  assert.match(statusList, /RUNNING/, "spread jobs gate still counts RUNNING");
});

// ── Guard 3: pricing/quote route returns message field on 422 ────────────────

test("Guard 3: pricing/quote route emits message field on pricing_not_ready", () => {
  const src = read("src/app/api/deals/[dealId]/pricing/quote/route.ts");
  assert.match(
    src,
    /error:\s*"pricing_not_ready"[\s\S]{0,200}?message/,
    "pricing_not_ready 422 response must include a human-readable message field",
  );
  assert.match(
    src,
    /Financial spread analysis is still running/,
    "spread-pending branch must surface the specific wait-and-retry message",
  );
});

// ── Guard 4: DealPricingClient handleQuote prefers json.message ──────────────

test("Guard 4: DealPricingClient handleQuote uses json.message before json.error", () => {
  const src = read("src/app/(app)/deals/[dealId]/pricing/DealPricingClient.tsx");
  assert.match(
    src,
    /json\?\.message\s*\?\?[\s\S]{0,80}?json\?\.error/,
    "handleQuote must prefer json.message so users see the human-readable error",
  );
});

// ── Guard 5: DealPricingClient refreshQuotes reload fallback ─────────────────

test("Guard 5: refreshQuotes falls back to window.location.reload() on non-ok", () => {
  const src = read("src/app/(app)/deals/[dealId]/pricing/DealPricingClient.tsx");
  assert.match(
    src,
    /async function refreshQuotes\(\)[\s\S]{0,400}?window\.location\.reload\(\)/,
    "refreshQuotes must reload as a fallback so banker doesn't get stuck after a failed lock fetch",
  );
});
