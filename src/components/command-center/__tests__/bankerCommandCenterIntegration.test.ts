/**
 * Spec 15P — Banker Command Center Integration & Visual Migration
 *
 * Source-level guards + render checks for wiring `BankerCommandCenter` above
 * the existing queue table while preserving the queue-table workflow.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BankerCommandCenter } from "@/components/command-center/BankerCommandCenter";
import { buildBankerCommandCenterFromDeals } from "@/lib/banker/buildBankerCommandCenterFromDeals";
import type { BankerQueueItem as CoreBankerQueueItem } from "@/core/command-center/types";

const PAGE_PATH = "src/components/command-center/BankerCommandCenterPage.tsx";

function readSource(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

function mkDeal(over: Partial<CoreBankerQueueItem> = {}): CoreBankerQueueItem {
  return {
    dealId: over.dealId ?? "deal-1",
    dealName: over.dealName ?? "Acme Holdings",
    borrowerName: over.borrowerName ?? "Jane",
    canonicalStage: over.canonicalStage ?? "documents",
    urgencyBucket: over.urgencyBucket ?? "watch",
    urgencyScore: over.urgencyScore ?? 50,
    queueDomain: over.queueDomain ?? "documents",
    queueReasonCode: over.queueReasonCode ?? "uploads_waiting_review",
    queueReasonLabel: over.queueReasonLabel ?? "Uploads waiting review",
    queueReasonDescription:
      over.queueReasonDescription ?? "Borrower uploads ready for banker review",
    blockingParty: over.blockingParty ?? "buddy",
    primaryActionCode: over.primaryActionCode ?? null,
    primaryActionLabel: over.primaryActionLabel ?? null,
    primaryActionPriority: over.primaryActionPriority ?? null,
    primaryActionAgeHours: over.primaryActionAgeHours ?? null,
    isActionExecutable: over.isActionExecutable ?? false,
    actionability: over.actionability ?? "review_required",
    href: over.href ?? "/banker/deals/deal-1/discovery",
    activeEscalationCount: over.activeEscalationCount ?? 0,
    borrowerOverdueCount: over.borrowerOverdueCount ?? 0,
    reviewBacklogCount: over.reviewBacklogCount ?? 0,
    latestActivityAt: over.latestActivityAt ?? null,
    changedSinceViewed: over.changedSinceViewed ?? false,
  };
}

// ---------------------------------------------------------------------------
// 1. Page wiring — source-level guards
// ---------------------------------------------------------------------------

test("BankerCommandCenterPage imports and uses the new BankerCommandCenter", () => {
  const src = readSource(PAGE_PATH);
  assert.ok(
    src.includes("import { BankerCommandCenter }"),
    "Must import BankerCommandCenter",
  );
  assert.ok(
    src.includes("buildBankerCommandCenterFromDeals"),
    "Must use the from-deals adapter",
  );
  assert.ok(
    src.includes("<BankerCommandCenter "),
    "Must render BankerCommandCenter in the page",
  );
});

test("BankerCommandCenterPage still renders the existing queue table workflow", () => {
  const src = readSource(PAGE_PATH);
  assert.ok(src.includes("<BankerQueueTable"));
  assert.ok(src.includes("<CommandCenterSummaryCards"));
  assert.ok(src.includes("<BankerQueueFilters"));
  assert.ok(src.includes("<CommandCenterFocusRail"));
  assert.ok(src.includes("<CommandCenterActivityDrawer"));
});

test("BankerCommandCenterPage keeps existing handlers wired", () => {
  const src = readSource(PAGE_PATH);
  // Existing queue-table behavior surfaces (execute, acknowledge, activity)
  // must remain wired so the operational workflow is preserved.
  assert.ok(src.includes("handleExecute"));
  assert.ok(src.includes("handleAcknowledge"));
  assert.ok(src.includes("handleViewActivity"));
  assert.ok(src.includes("/api/command-center/acknowledge"));
});

test("BankerCommandCenterPage adds an 'All Deals' heading above the queue", () => {
  const src = readSource(PAGE_PATH);
  assert.ok(
    src.includes("All Deals"),
    "Expected an 'All Deals' heading to delineate the existing queue area",
  );
});

test("BankerCommandCenterPage exposes loading + unavailable fallback states", () => {
  const src = readSource(PAGE_PATH);
  assert.ok(
    src.includes('aria-label="Loading command center intelligence"'),
    "Loading state must be accessible",
  );
  assert.ok(
    src.includes("Command center intelligence is unavailable"),
    "Unavailable state copy must be present",
  );
});

// ---------------------------------------------------------------------------
// 2. Render integration — adapter + panel co-render correctly
// ---------------------------------------------------------------------------

test("BankerCommandCenter renders queue sections derived from existing-queue rows", () => {
  const deals: CoreBankerQueueItem[] = [
    mkDeal({
      dealId: "d-1",
      queueReasonCode: "uploads_waiting_review",
      blockingParty: "buddy",
    }),
    mkDeal({
      dealId: "d-2",
      queueReasonCode: "annual_review_collecting",
      blockingParty: "borrower",
      borrowerOverdueCount: 2,
    }),
    mkDeal({
      dealId: "d-3",
      queueReasonCode: "readiness_blocked",
      blockingParty: "mixed",
    }),
  ];
  const vm = buildBankerCommandCenterFromDeals({ deals });
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  // Ready-for-banker-review section appears because d-1 maps there.
  assert.ok(html.includes("Ready for Banker Review"));
  // Borrower-action section appears because d-2 maps to that bucket.
  assert.ok(html.includes("Waiting on Borrower"));
  // Operationally-blocked section appears because d-3 has readiness_blocked.
  assert.ok(html.includes("Operationally Blocked"));
  // Borrower-intelligence fallback copy must be visible.
  assert.ok(html.includes("Borrower intelligence not available yet"));
});

test("adapter-built VM renders empty-state copy when no deals provided", () => {
  const vm = buildBankerCommandCenterFromDeals({ deals: [] });
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("No active deals on the queue"));
});

test("adapter-built command center carries href passthroughs", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        href: "/banker/deals/d-1/discovery",
        queueReasonCode: "uploads_waiting_review",
      }),
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes('href="/banker/deals/d-1/discovery"'));
});

// ---------------------------------------------------------------------------
// 3. Dark-theme classes
// ---------------------------------------------------------------------------

test("integrated panel uses dark-theme color tokens", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [mkDeal({ dealId: "d-1" })],
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("text-white"));
  // Must NOT carry any of the borrower-portal light-card patterns.
  assert.ok(!html.includes("bg-stone-50"), "must not leak light-theme background");
});

// ---------------------------------------------------------------------------
// 4. No internal enum leakage / no forbidden terms
// ---------------------------------------------------------------------------

test("integrated panel does not leak internal enums or tech terms", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({ dealId: "d-1" }),
      mkDeal({ dealId: "d-2", blockingParty: "borrower" }),
      mkDeal({ dealId: "d-3", queueReasonCode: "readiness_blocked" }),
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const term of [
    "docs_in_progress",
    "lifecycle",
    "credit_memo",
    "classifier",
    "supabase",
    "extraction failed",
    "parser error",
    "fake sla",
    "simulated",
  ]) {
    assert.ok(!lower.includes(term), `Internal term "${term}" leaked`);
  }
});

// ---------------------------------------------------------------------------
// 5. No approval / funding guarantee language
// ---------------------------------------------------------------------------

test("integrated panel renders no approval/funding guarantee phrases", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({ dealId: "d-1" }),
      mkDeal({ dealId: "d-2", urgencyBucket: "critical" }),
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const term of [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "borrower qualifies",
    "loan will fund",
    "pre-approved",
    "conditional approval",
    "risk score",
    "credit decision",
  ]) {
    assert.ok(!lower.includes(term), `Forbidden phrase "${term}"`);
  }
});

// ---------------------------------------------------------------------------
// 6. No fake SLA / timestamp language
// ---------------------------------------------------------------------------

test("integrated panel renders no SLA countdown or invented timestamp copy", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [mkDeal({ dealId: "d-1", latestActivityAt: null })],
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const phrase of [
    "sla countdown",
    "response due in",
    "due by",
    "remaining sla",
  ]) {
    assert.ok(!lower.includes(phrase), `Forbidden SLA phrase "${phrase}"`);
  }
  // No ISO timestamp should appear when no activity is provided.
  assert.equal(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(html), false);
});

// ---------------------------------------------------------------------------
// 7. Existing queue table import contract preserved
// ---------------------------------------------------------------------------

test("BankerQueueTable export is still imported by the page", () => {
  const src = readSource(PAGE_PATH);
  assert.ok(src.includes('from "./BankerQueueTable"'));
});

test("CommandCenterSummaryCards and Filters still imported by the page", () => {
  const src = readSource(PAGE_PATH);
  assert.ok(src.includes('from "./CommandCenterSummaryCards"'));
  assert.ok(src.includes('from "./BankerQueueFilters"'));
});
