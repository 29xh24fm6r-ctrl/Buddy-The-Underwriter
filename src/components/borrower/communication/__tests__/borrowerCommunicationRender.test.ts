import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerCommunicationCenter } from "@/components/borrower/communication/BorrowerCommunicationCenter";
import { BorrowerActionNeededBanner } from "@/components/borrower/communication/BorrowerActionNeededBanner";
import { BorrowerRecentUpdatesTimeline } from "@/components/borrower/communication/BorrowerRecentUpdatesTimeline";
import { BorrowerResponseNeededCard } from "@/components/borrower/communication/BorrowerResponseNeededCard";
import { BorrowerWaitingOnStatus } from "@/components/borrower/communication/BorrowerWaitingOnStatus";
import { BorrowerNoActionReassurance } from "@/components/borrower/communication/BorrowerNoActionReassurance";
import {
  buildBorrowerCommunicationViewModel,
  type CommunicationInput,
} from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(
  overrides: Partial<CommunicationInput> = {},
): CommunicationInput {
  return {
    borrowerName: "Jane Doe",
    token: "test-token",
    portalStage: "additional_items_needed",
    activity: [
      {
        id: "a1",
        label: "Buddy received your document",
        timestamp: "2026-05-15T12:00:00Z",
        category: "upload",
      },
    ],
    blockers: [{ id: "b1", label: "Missing 1919 form" }],
    documents: [
      {
        id: "d1",
        label: "Business Tax Returns",
        status: "missing",
        required: true,
        href: "/upload/test-token",
      },
      {
        id: "d2",
        label: "Balance Sheet",
        status: "needs_attention",
        required: true,
      },
    ],
    recommendations: [
      { id: "r1", label: "Add a payroll report", priority: "high" },
    ],
    guidanceNextStep: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Full communication center renders
// ---------------------------------------------------------------------------

test("BorrowerCommunicationCenter renders full state", () => {
  const vm = buildBorrowerCommunicationViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerCommunicationCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Messages &amp; Updates"));
  assert.ok(html.includes("Items needing your response"));
  assert.ok(html.includes("Recent updates"));
  assert.ok(html.includes("Action needed:"));
});

// ---------------------------------------------------------------------------
// 2. Minimal/empty state
// ---------------------------------------------------------------------------

test("BorrowerCommunicationCenter renders minimal state with no items", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      portalStage: "getting_started",
      activity: [],
      blockers: [],
      documents: [],
      recommendations: [],
    }),
  );
  const html = renderToStaticMarkup(
    React.createElement(BorrowerCommunicationCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Messages &amp; Updates"));
  assert.ok(html.includes("No borrower action needed"));
  assert.ok(!html.includes("Action needed:"));
});

// ---------------------------------------------------------------------------
// 3. Action needed banner
// ---------------------------------------------------------------------------

test("BorrowerActionNeededBanner renders action state", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerActionNeededBanner, {
      state: "action_needed",
      count: 3,
      primaryCtaLabel: "Add requested document",
      primaryCtaHref: "/upload/test-token",
      topItems: [
        {
          id: "1",
          label: "Business Tax Returns",
          reason: "Needed for review.",
          priority: "required",
          href: "/upload/test-token",
        },
      ],
    }),
  );
  assert.ok(html.includes("3 items need your attention"));
  assert.ok(html.includes("Add requested document"));
  assert.ok(html.includes("/upload/test-token"));
});

test("BorrowerActionNeededBanner renders blocked state", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerActionNeededBanner, {
      state: "blocked",
      count: 1,
      topItems: [
        {
          id: "1",
          label: "Missing 1919 form",
          reason: "This must be resolved.",
          priority: "required",
        },
      ],
    }),
  );
  assert.ok(html.includes("1 item blocking next step"));
  assert.ok(html.includes("Missing 1919 form"));
});

// ---------------------------------------------------------------------------
// 4. Response needed card
// ---------------------------------------------------------------------------

test("BorrowerResponseNeededCard renders items with priority badges", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerResponseNeededCard, {
      items: [
        {
          id: "1",
          label: "Business Tax Returns",
          reason: "Required for SBA package.",
          priority: "required",
          href: "/upload/test-token",
        },
        {
          id: "2",
          label: "Add payroll report",
          reason: "May strengthen your package.",
          priority: "helpful",
        },
      ],
    }),
  );
  assert.ok(html.includes("Items needing your response"));
  assert.ok(html.includes("Required"));
  assert.ok(html.includes("Helpful"));
  assert.ok(html.includes("Respond"));
});

test("BorrowerResponseNeededCard renders nothing when items empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerResponseNeededCard, { items: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 5. Recent updates timeline
// ---------------------------------------------------------------------------

test("BorrowerRecentUpdatesTimeline renders updates", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerRecentUpdatesTimeline, {
      updates: [
        {
          id: "1",
          label: "Buddy received your document",
          timestamp: "2026-05-15T12:00:00Z",
          type: "document_received",
        },
        {
          id: "2",
          label: "Action needed: Missing 1919 form",
          type: "blocker_added",
        },
      ],
    }),
  );
  assert.ok(html.includes("Recent updates"));
  assert.ok(html.includes("Buddy received your document"));
  assert.ok(html.includes("Action needed: Missing 1919 form"));
});

test("BorrowerRecentUpdatesTimeline renders graceful empty state", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerRecentUpdatesTimeline, { updates: [] }),
  );
  assert.ok(html.includes("Recent updates"));
  assert.ok(html.includes("Buddy will show recent updates here"));
});

// ---------------------------------------------------------------------------
// 6. Waiting-on status
// ---------------------------------------------------------------------------

test("BorrowerWaitingOnStatus renders waiting on borrower", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerWaitingOnStatus, {
      waitingOn: "borrower",
      label: "Waiting on borrower documents",
    }),
  );
  assert.ok(html.includes("Waiting on borrower documents"));
});

test("BorrowerWaitingOnStatus renders waiting on Buddy review", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerWaitingOnStatus, {
      waitingOn: "buddy_review",
      label: "Waiting on Buddy review",
    }),
  );
  assert.ok(html.includes("Waiting on Buddy review"));
});

test("BorrowerWaitingOnStatus renders waiting on banker review", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerWaitingOnStatus, {
      waitingOn: "banker_review",
      label: "Waiting on banker review",
    }),
  );
  assert.ok(html.includes("Waiting on banker review"));
});

// ---------------------------------------------------------------------------
// 7. No-action reassurance
// ---------------------------------------------------------------------------

test("BorrowerNoActionReassurance renders message", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerNoActionReassurance, {
      message: "Buddy will surface new items if anything else is needed.",
    }),
  );
  assert.ok(html.includes("No borrower action needed"));
  assert.ok(html.includes("Buddy will surface new items"));
});

// ---------------------------------------------------------------------------
// 8. CTA rendering only when href exists
// ---------------------------------------------------------------------------

test("BorrowerActionNeededBanner omits CTA when no href", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerActionNeededBanner, {
      state: "action_needed",
      count: 1,
      topItems: [
        {
          id: "1",
          label: "Missing item",
          reason: "Needed.",
          priority: "required",
        },
      ],
    }),
  );
  assert.ok(!html.includes("/upload/"));
});

test("BorrowerResponseNeededCard hides Respond button when href absent", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerResponseNeededCard, {
      items: [
        {
          id: "1",
          label: "Pending item",
          reason: "Pending review.",
          priority: "helpful",
        },
      ],
    }),
  );
  assert.ok(!html.includes("Respond"));
});

// ---------------------------------------------------------------------------
// 9. No internal status leakage
// ---------------------------------------------------------------------------

test("rendered communication center does not leak internal enum tokens", () => {
  const vm = buildBorrowerCommunicationViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerCommunicationCenter, { viewModel: vm }),
  );
  for (const enumKey of [
    "docs_in_progress",
    "underwriting_queue",
    "internal review queue",
    "lifecycle",
    "credit_memo",
  ]) {
    assert.ok(
      !html.toLowerCase().includes(enumKey),
      `Internal enum "${enumKey}" leaked in rendered HTML`,
    );
  }
});

// ---------------------------------------------------------------------------
// 10. No fake banker message rendering
// ---------------------------------------------------------------------------

test("rendered communication center contains no fake banker messages", () => {
  const vm = buildBorrowerCommunicationViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerCommunicationCenter, { viewModel: vm }),
  ).toLowerCase();
  for (const phrase of [
    "banker said",
    "banker note",
    "your banker wrote",
    "underwriter wrote",
    "banker mentioned",
  ]) {
    assert.ok(!html.includes(phrase), `Fake banker phrase "${phrase}" present`);
  }
});

// ---------------------------------------------------------------------------
// 11. No approval/guarantee language
// ---------------------------------------------------------------------------

test("rendered communication center contains no approval/guarantee/risk language", () => {
  const vm = buildBorrowerCommunicationViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerCommunicationCenter, { viewModel: vm }),
  ).toLowerCase();
  for (const term of [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "you qualify",
    "you are approved",
    "your loan will",
    "risk score",
    "credit score",
  ]) {
    assert.ok(!html.includes(term), `Forbidden phrase "${term}" present`);
  }
});

// ---------------------------------------------------------------------------
// 12. No forbidden borrower terms across states
// ---------------------------------------------------------------------------

test("rendered communication center contains no forbidden borrower terms across states", () => {
  const stages: CommunicationInput["portalStage"][] = [
    "getting_started",
    "documents_requested",
    "documents_received",
    "buddy_reviewing",
    "additional_items_needed",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const vm = buildBorrowerCommunicationViewModel(
      baseInput({ portalStage: stage }),
    );
    const html = renderToStaticMarkup(
      React.createElement(BorrowerCommunicationCenter, { viewModel: vm }),
    ).toLowerCase();
    for (const term of FORBIDDEN_BORROWER_TERMS) {
      assert.ok(
        !html.includes(term.toLowerCase()),
        `Forbidden term "${term}" in stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 13. Mobile-safe layout (large tap targets, no horizontal scroll)
// ---------------------------------------------------------------------------

test("BorrowerCommunicationCenter uses mobile-safe layout (no dense tables)", () => {
  const vm = buildBorrowerCommunicationViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerCommunicationCenter, { viewModel: vm }),
  );
  assert.ok(!html.includes("<table"));
  assert.ok(html.includes("min-h-11"));
});
