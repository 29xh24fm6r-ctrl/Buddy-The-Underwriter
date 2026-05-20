import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerMobileCommandCenter } from "@/components/borrower/mobile/BorrowerMobileCommandCenter";
import { BorrowerMobileNextActionBar } from "@/components/borrower/mobile/BorrowerMobileNextActionBar";
import { BorrowerMobileDocumentPriorityStack } from "@/components/borrower/mobile/BorrowerMobileDocumentPriorityStack";
import { BorrowerMobileSection } from "@/components/borrower/mobile/BorrowerMobileSection";
import {
  buildBorrowerMobileCommandViewModel,
  type BorrowerMobileCommandViewModel,
  type MobileCommandInput,
} from "@/lib/borrower/buildBorrowerMobileCommandViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
import {
  buildBorrowerReadinessViewModel,
  type ReadinessInput,
} from "@/lib/borrower/buildBorrowerReadinessViewModel";
import {
  buildBorrowerGuidanceViewModel,
  type GuidanceInput,
} from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import {
  buildBorrowerCommunicationViewModel,
  type CommunicationInput,
} from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import {
  buildBorrowerDocumentExperienceViewModel,
  type BorrowerDocumentItemInput,
} from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJourney(over: Partial<JourneyInput> = {}) {
  return buildBorrowerJourneyViewModel({
    dealName: "Acme SBA",
    borrowerName: "Jane Doe",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
    ],
    completedItems: [{ id: "c1", title: "Personal Financial Statement" }],
    portalStage: "additional_items_needed",
    token: "test-token",
    ...over,
  });
}

function makeReadiness(over: Partial<ReadinessInput> = {}) {
  return buildBorrowerReadinessViewModel({
    borrowerName: "Jane Doe",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    docsVerified: 3,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    sbaFormsReceived: 0,
    sbaFormsRequired: 0,
    blockerCount: 2,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
    ],
    completedItems: [{ id: "c1", title: "Personal Financial Statement" }],
    activity: [],
    portalStage: "additional_items_needed",
    token: "test-token",
    ...over,
  });
}

function makeGuidance(over: Partial<GuidanceInput> = {}) {
  return buildBorrowerGuidanceViewModel({
    borrowerName: "Jane Doe",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsVerified: 3,
    docsInFlight: false,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    blockerCount: 2,
    readinessScore: 45,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
    ],
    completedItems: [{ id: "c1", title: "Personal Financial Statement" }],
    hasActivity: true,
    recommendationCount: 2,
    portalStage: "additional_items_needed",
    token: "test-token",
    ...over,
  });
}

function makeCommunication(over: Partial<CommunicationInput> = {}) {
  return buildBorrowerCommunicationViewModel({
    borrowerName: "Jane Doe",
    token: "test-token",
    portalStage: "additional_items_needed",
    activity: [],
    blockers: [
      { id: "b1", label: "Business Tax Returns", href: "/upload/test-token" },
    ],
    documents: [
      {
        id: "d1",
        label: "Business Tax Returns",
        status: "missing",
        required: true,
        href: "/upload/test-token",
      },
    ],
    recommendations: [],
    ...over,
  });
}

function makeDocuments(items: BorrowerDocumentItemInput[]) {
  return buildBorrowerDocumentExperienceViewModel({
    token: "test-token",
    items,
  });
}

function makeVM(over: Partial<MobileCommandInput> = {}): BorrowerMobileCommandViewModel {
  const documents = over.documents ?? makeDocuments([
    { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
  ]);
  return buildBorrowerMobileCommandViewModel({
    borrowerName: "Jane Doe",
    token: "test-token",
    journey: makeJourney(),
    readiness: makeReadiness(),
    guidance: makeGuidance(),
    communication: makeCommunication(),
    documents,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// 1. Mobile command center full state
// ---------------------------------------------------------------------------

test("BorrowerMobileCommandCenter renders headline, summary, progress, CTA", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Today’s focus"));
  assert.ok(html.includes("attention"));
  assert.ok(html.includes("% complete"));
  assert.ok(html.includes("/upload/test-token"));
});

// ---------------------------------------------------------------------------
// 2. Mobile command center fallback
// ---------------------------------------------------------------------------

test("BorrowerMobileCommandCenter renders no-action fallback", () => {
  const vm = makeVM({
    communication: makeCommunication({
      blockers: [],
      documents: [],
      portalStage: "getting_started",
    }),
    documents: makeDocuments([]),
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Today’s focus"));
  assert.ok(html.includes("No borrower action needed"));
  assert.ok(!html.includes("/upload/test-token"));
});

// ---------------------------------------------------------------------------
// 3. Sticky next action bar with CTA
// ---------------------------------------------------------------------------

test("BorrowerMobileNextActionBar shows CTA when action available", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileNextActionBar, { viewModel: vm }),
  );
  assert.ok(html.includes("Next action"));
  assert.ok(html.includes("/upload/test-token"));
  assert.ok(html.includes("aria-label"));
});

// ---------------------------------------------------------------------------
// 4. Sticky next action bar without CTA
// ---------------------------------------------------------------------------

test("BorrowerMobileNextActionBar hides upload CTA when no action needed", () => {
  const vm = makeVM({
    communication: makeCommunication({
      blockers: [],
      documents: [],
      portalStage: "getting_started",
    }),
    documents: makeDocuments([]),
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileNextActionBar, { viewModel: vm }),
  );
  assert.ok(!html.includes("/upload/test-token"));
  assert.ok(html.includes("All caught up"));
  assert.ok(html.toLowerCase().includes("no action"));
});

// ---------------------------------------------------------------------------
// 5. Document priority stack
// ---------------------------------------------------------------------------

test("BorrowerMobileDocumentPriorityStack renders up to 3 items", () => {
  const vm = makeVM({
    documents: makeDocuments([
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
      { id: "d3", title: "Debt Schedule", required: true, status: "needs_attention" },
    ]),
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileDocumentPriorityStack, {
      items: vm.documentPriorityItems,
      hasMore: vm.hasMoreDocumentItems,
    }),
  );
  assert.ok(html.includes("Documents to handle next"));
  assert.ok(html.includes("Business tax returns") || html.includes("Business Tax Returns"));
  assert.ok(html.includes("Balance sheet") || html.includes("Balance Sheet"));
});

// ---------------------------------------------------------------------------
// 6. More-items indicator
// ---------------------------------------------------------------------------

test("BorrowerMobileDocumentPriorityStack shows 'see all' when hasMore", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileDocumentPriorityStack, {
      items: [
        {
          id: "1",
          label: "Business Tax Returns",
          priority: "required",
          href: "/upload/test-token",
        },
      ],
      hasMore: true,
    }),
  );
  assert.ok(html.includes("See all documents"));
});

test("BorrowerMobileDocumentPriorityStack hides 'see all' when not hasMore", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileDocumentPriorityStack, {
      items: [
        {
          id: "1",
          label: "Business Tax Returns",
          priority: "required",
          href: "/upload/test-token",
        },
      ],
      hasMore: false,
    }),
  );
  assert.ok(!html.includes("See all documents"));
});

// ---------------------------------------------------------------------------
// 7. Collapsible mobile section
// ---------------------------------------------------------------------------

test("BorrowerMobileSection renders header and aria attributes", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileSection, {
      title: "Activity",
      subtitle: "Recent updates",
      defaultOpen: false,
      children: React.createElement("p", null, "child content"),
    }),
  );
  assert.ok(html.includes("Activity"));
  assert.ok(html.includes("Recent updates"));
  assert.ok(html.includes("aria-expanded"));
  assert.ok(html.includes("aria-controls"));
  // Closed by default → child hidden
  assert.ok(!html.includes("child content"));
});

test("BorrowerMobileSection renders children when defaultOpen", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileSection, {
      title: "Activity",
      defaultOpen: true,
      children: React.createElement("p", null, "child content"),
    }),
  );
  assert.ok(html.includes("child content"));
  assert.ok(html.includes('aria-expanded="true"'));
  assert.ok(html.includes('role="region"'));
});

// ---------------------------------------------------------------------------
// 8. Aria labels / accessible button text
// ---------------------------------------------------------------------------

test("primary CTAs include accessible aria-label", () => {
  const vm = makeVM();
  const center = renderToStaticMarkup(
    React.createElement(BorrowerMobileCommandCenter, { viewModel: vm }),
  );
  const bar = renderToStaticMarkup(
    React.createElement(BorrowerMobileNextActionBar, { viewModel: vm }),
  );
  assert.ok(/aria-label="[^"]+"/.test(center));
  assert.ok(/aria-label="[^"]+"/.test(bar));
});

test("document priority stack upload links include aria-label", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileDocumentPriorityStack, {
      items: [
        {
          id: "1",
          label: "Business Tax Returns",
          priority: "required",
          href: "/upload/test-token",
        },
      ],
      hasMore: false,
    }),
  );
  assert.ok(html.includes("Upload Business Tax Returns"));
});

// ---------------------------------------------------------------------------
// 9. No internal status leakage
// ---------------------------------------------------------------------------

test("rendered mobile components do not leak internal enum tokens", () => {
  const vm = makeVM();
  const html =
    renderToStaticMarkup(
      React.createElement(BorrowerMobileCommandCenter, { viewModel: vm }),
    ) +
    renderToStaticMarkup(
      React.createElement(BorrowerMobileNextActionBar, { viewModel: vm }),
    ) +
    renderToStaticMarkup(
      React.createElement(BorrowerMobileDocumentPriorityStack, {
        items: vm.documentPriorityItems,
        hasMore: vm.hasMoreDocumentItems,
      }),
    );

  for (const enumKey of [
    "docs_in_progress",
    "underwriting_queue",
    "internal review queue",
    "lifecycle",
    "credit_memo",
    "classifier",
    "extraction failed",
    "parser error",
  ]) {
    assert.ok(
      !html.toLowerCase().includes(enumKey.toLowerCase()),
      `Internal token "${enumKey}" leaked`,
    );
  }
});

// ---------------------------------------------------------------------------
// 10. No approval / guarantee language
// ---------------------------------------------------------------------------

test("rendered mobile components contain no approval/guarantee language", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMobileCommandCenter, { viewModel: vm }),
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
    assert.ok(!html.includes(term), `Approval/guarantee term "${term}" present`);
  }
});

// ---------------------------------------------------------------------------
// 11. No fake upload / completeness claims
// ---------------------------------------------------------------------------

test("rendered mobile components contain no fake upload/completeness claims", () => {
  const vm = makeVM();
  const html =
    renderToStaticMarkup(
      React.createElement(BorrowerMobileCommandCenter, { viewModel: vm }),
    ) +
    renderToStaticMarkup(
      React.createElement(BorrowerMobileDocumentPriorityStack, {
        items: vm.documentPriorityItems,
        hasMore: vm.hasMoreDocumentItems,
      }),
    );
  const lower = html.toLowerCase();

  for (const phrase of [
    "extraction succeeded",
    "extraction failed",
    "ocr complete",
    "ocr failed",
    "100% complete",
    "fully complete",
    "package complete",
  ]) {
    assert.ok(!lower.includes(phrase), `Forbidden phrase "${phrase}" present`);
  }
});

// ---------------------------------------------------------------------------
// 12. Forbidden borrower terms across states
// ---------------------------------------------------------------------------

test("rendered mobile components contain no forbidden borrower terms across states", () => {
  const stages = [
    "getting_started",
    "additional_items_needed",
    "buddy_reviewing",
    "ready_for_sba_review",
  ] as const;

  for (const stage of stages) {
    const vm = makeVM({
      communication: makeCommunication({ portalStage: stage }),
    });
    const html =
      renderToStaticMarkup(
        React.createElement(BorrowerMobileCommandCenter, { viewModel: vm }),
      ) +
      renderToStaticMarkup(
        React.createElement(BorrowerMobileNextActionBar, { viewModel: vm }),
      );
    const lower = html.toLowerCase();
    for (const term of FORBIDDEN_BORROWER_TERMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `Forbidden term "${term}" in stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 13. Mobile-safe structure (no tables, large tap targets)
// ---------------------------------------------------------------------------

test("mobile components avoid dense tables and meet min tap target", () => {
  const vm = makeVM();
  const html =
    renderToStaticMarkup(
      React.createElement(BorrowerMobileCommandCenter, { viewModel: vm }),
    ) +
    renderToStaticMarkup(
      React.createElement(BorrowerMobileNextActionBar, { viewModel: vm }),
    ) +
    renderToStaticMarkup(
      React.createElement(BorrowerMobileDocumentPriorityStack, {
        items: vm.documentPriorityItems,
        hasMore: vm.hasMoreDocumentItems,
      }),
    );

  assert.ok(!html.includes("<table"));
  assert.ok(html.includes("min-h-11") || html.includes("min-h-12"));
});

// ---------------------------------------------------------------------------
// 14. Source-level guards
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../..",
);

function readSource(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("sticky next action bar applies safe-area-inset-bottom padding", () => {
  const source = readSource(
    "src/components/borrower/mobile/BorrowerMobileNextActionBar.tsx",
  );
  assert.match(source, /safe-area-inset-bottom/);
});

test("mobile sticky bar is mobile-only via BorrowerShell footer (sm:hidden)", () => {
  const shell = readSource("src/components/borrower/BorrowerShell.tsx");
  assert.match(shell, /sm:hidden/);
});

test("mobile components do not use hover-only information patterns", () => {
  const files = [
    "src/components/borrower/mobile/BorrowerMobileCommandCenter.tsx",
    "src/components/borrower/mobile/BorrowerMobileNextActionBar.tsx",
    "src/components/borrower/mobile/BorrowerMobileDocumentPriorityStack.tsx",
    "src/components/borrower/mobile/BorrowerMobileSection.tsx",
  ];
  for (const file of files) {
    const source = readSource(file);
    // No hover: prefixes used to gate visibility of content (we allow hover styling for affordances)
    assert.ok(
      !/hover:opacity-100/.test(source),
      `hover-only visibility detected in ${file}`,
    );
    assert.ok(
      !/group-hover:opacity-100/.test(source),
      `group-hover-only visibility detected in ${file}`,
    );
  }
});

test("mobile components do not rely on fixed pixel widths that overflow", () => {
  const files = [
    "src/components/borrower/mobile/BorrowerMobileCommandCenter.tsx",
    "src/components/borrower/mobile/BorrowerMobileNextActionBar.tsx",
    "src/components/borrower/mobile/BorrowerMobileDocumentPriorityStack.tsx",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert.ok(
      !/w-\[\d{4,}px\]/.test(source),
      `large fixed pixel width detected in ${file}`,
    );
  }
});
