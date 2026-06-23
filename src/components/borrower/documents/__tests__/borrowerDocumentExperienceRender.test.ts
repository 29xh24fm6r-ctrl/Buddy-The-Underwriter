import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerDocumentExperience } from "@/components/borrower/documents/BorrowerDocumentExperience";
import { BorrowerDocumentPackageSummary } from "@/components/borrower/documents/BorrowerDocumentPackageSummary";
import { BorrowerDocumentGroupCard } from "@/components/borrower/documents/BorrowerDocumentGroupCard";
import { BorrowerDocumentRequirementCard } from "@/components/borrower/documents/BorrowerDocumentRequirementCard";
import { BorrowerDocumentGuidanceBlock } from "@/components/borrower/documents/BorrowerDocumentGuidanceBlock";
import { BorrowerDocumentAttentionCard } from "@/components/borrower/documents/BorrowerDocumentAttentionCard";
import {
  buildBorrowerDocumentExperienceViewModel,
  type DocumentExperienceInput,
  type BorrowerDocumentItemInput,
} from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function input(items: BorrowerDocumentItemInput[]): DocumentExperienceInput {
  return { token: "test-token", items };
}

function baseItems(): BorrowerDocumentItemInput[] {
  return [
    {
      id: "i1",
      title: "Business Tax Returns",
      required: true,
      group: "Tax Returns",
      status: "missing",
    },
    {
      id: "i2",
      title: "Balance Sheet",
      required: true,
      group: "Financial Statements",
      status: "received",
      uploadCount: 1,
      latestUploadedAt: "2026-05-10T12:00:00Z",
    },
    {
      id: "i3",
      title: "SBA Form 1919",
      required: true,
      group: "SBA Forms",
      status: "needs_attention",
    },
    {
      id: "i4",
      title: "Insurance Documents",
      required: false,
      group: "Business Documents",
      status: "missing",
    },
  ];
}

// ---------------------------------------------------------------------------
// 1. Full experience renders end to end
// ---------------------------------------------------------------------------

test("BorrowerDocumentExperience renders full state", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentExperience, { viewModel: vm }),
  );
  assert.ok(html.includes("Your documents"));
  assert.ok(html.includes("Document package"));
  assert.ok(html.includes("Items Buddy needs next"));
  assert.ok(html.includes("Business tax returns"));
});

// ---------------------------------------------------------------------------
// 2. Minimal / empty state renders without throwing
// ---------------------------------------------------------------------------

test("BorrowerDocumentExperience renders minimal state with no items", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input([]));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentExperience, { viewModel: vm }),
  );
  assert.ok(html.includes("Document package"));
  assert.ok(html.includes("requested documents here"));
  assert.ok(!html.includes("Items Buddy needs next"));
});

// ---------------------------------------------------------------------------
// 3. Package summary rendering
// ---------------------------------------------------------------------------

test("BorrowerDocumentPackageSummary renders counts and summary string", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentPackageSummary, {
      summary: vm.packageSummary,
    }),
  );
  assert.ok(html.includes("Document package"));
  assert.ok(html.includes("required item"));
  assert.ok(html.includes("Required remaining"));
  assert.ok(html.includes("Optional received"));
  assert.ok(html.includes("Needs attention"));
});

// ---------------------------------------------------------------------------
// 4. Group card renders with completion + attention badge
// ---------------------------------------------------------------------------

test("BorrowerDocumentGroupCard renders title, description, and completion", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  const group = vm.groups.find((g) => g.id === "sba_forms");
  assert.ok(group);
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentGroupCard, { group }),
  );
  assert.ok(html.includes("SBA forms"));
  assert.ok(html.includes("Standard SBA forms"));
  // 0 of 1 required received
  assert.ok(html.includes("required received"));
  // needs attention badge
  assert.ok(html.includes("need") && html.includes("attention"));
});

// ---------------------------------------------------------------------------
// 5. Requirement card statuses
// ---------------------------------------------------------------------------

test("BorrowerDocumentRequirementCard renders missing state", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      { id: "a", title: "Business Tax Returns", required: true, status: "missing" },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentRequirementCard, { requirement: req }),
  );
  assert.ok(html.includes("Needed"));
  assert.ok(html.includes("Upload document"));
  assert.ok(html.includes("/upload/test-token"));
});

test("BorrowerDocumentRequirementCard renders received reassurance", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "a",
        title: "Business Tax Returns",
        required: true,
        status: "received",
        uploadCount: 1,
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentRequirementCard, { requirement: req }),
  );
  assert.ok(html.includes("Received"));
  assert.ok(html.includes("Buddy received this document"));
});

test("BorrowerDocumentRequirementCard renders accepted state with no CTA", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "a",
        title: "Personal Financial Statement",
        required: true,
        status: "accepted",
        uploadCount: 1,
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentRequirementCard, { requirement: req }),
  );
  assert.ok(html.includes("Looks good"));
  assert.ok(!html.includes("/upload/"));
});

// ---------------------------------------------------------------------------
// 6. Guidance block copy
// ---------------------------------------------------------------------------

test("BorrowerDocumentGuidanceBlock renders why/helpful/avoid sections when expanded", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentGuidanceBlock, {
      defaultExpanded: true,
      guidance: {
        label: "Business tax returns",
        whyItMatters: "These are the primary evidence of business income.",
        helpfulUploadHint: "Upload the complete signed federal return.",
        commonIssueToAvoid: "Avoid uploading only the first page.",
        acceptedFormatsCopy: "PDF is best.",
      },
    }),
  );
  assert.ok(html.includes("Why it matters"));
  assert.ok(html.includes("What a helpful upload includes"));
  assert.ok(html.includes("Common issue to avoid"));
  assert.ok(html.includes("Accepted formats"));
  assert.ok(html.includes("primary evidence"));
});

test("BorrowerDocumentGuidanceBlock is collapsed by default", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentGuidanceBlock, {
      guidance: {
        label: "Business tax returns",
        whyItMatters: "Reason copy.",
        helpfulUploadHint: "Hint copy.",
      },
    }),
  );
  assert.ok(html.includes("What a good upload looks like"));
  assert.ok(!html.includes("Reason copy"));
});

// ---------------------------------------------------------------------------
// 7. Needs-attention recovery copy
// ---------------------------------------------------------------------------

test("BorrowerDocumentRequirementCard renders recovery copy for needs_attention", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "a",
        title: "Business Tax Returns",
        required: true,
        status: "needs_attention",
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentRequirementCard, { requirement: req }),
  );
  assert.ok(html.includes("Needs attention"));
  assert.ok(
    html.includes("clearer copy") ||
      html.includes("all pages") ||
      html.includes("complete version"),
  );
  assert.ok(html.includes("Upload a clearer version"));
});

// ---------------------------------------------------------------------------
// 8. Replacement CTA rendering
// ---------------------------------------------------------------------------

test("BorrowerDocumentRequirementCard renders replacement CTA when uploaded once", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "a",
        title: "Business Tax Returns",
        required: true,
        status: "received",
        uploadCount: 1,
        latestUploadedAt: "2026-05-10T12:00:00Z",
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentRequirementCard, { requirement: req }),
  );
  assert.ok(html.includes("Upload updated version"));
  assert.ok(html.includes("does not erase your previous submission"));
});

// ---------------------------------------------------------------------------
// 9. Attention card primary items
// ---------------------------------------------------------------------------

test("BorrowerDocumentAttentionCard renders attention items", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentAttentionCard, {
      items: vm.primaryAttentionItems,
    }),
  );
  assert.ok(html.includes("Items Buddy needs next"));
  assert.ok(html.includes("SBA Form 1919"));
});

test("BorrowerDocumentAttentionCard renders nothing when items empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentAttentionCard, { items: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 10. Mobile-safe structure (large tap targets, no horizontal scroll)
// ---------------------------------------------------------------------------

test("BorrowerDocumentExperience uses mobile-safe layout (no dense tables)", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentExperience, { viewModel: vm }),
  );
  assert.ok(!html.includes("<table"));
  // CTAs should have at least min-h-11 (mobile tap target)
  assert.ok(html.includes("min-h-11"));
});

// ---------------------------------------------------------------------------
// 11. No fake extraction/completeness claims
// ---------------------------------------------------------------------------

test("rendered experience never claims fake extraction or completeness", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentExperience, { viewModel: vm }),
  ).toLowerCase();

  for (const phrase of [
    "extraction succeeded",
    "extraction failed",
    "ocr complete",
    "ocr failed",
    "classifier",
    "parser error",
    "100% complete",
  ]) {
    assert.ok(
      !html.includes(phrase),
      `Forbidden phrase "${phrase}" in rendered experience`,
    );
  }
});

// ---------------------------------------------------------------------------
// 12. No internal status enum leakage
// ---------------------------------------------------------------------------

test("rendered experience does not leak internal status enums", () => {
  const allStatuses = [
    "missing",
    "uploaded",
    "received",
    "reviewing",
    "accepted",
    "needs_attention",
    "optional",
    "unavailable",
  ] as const;

  const items: BorrowerDocumentItemInput[] = allStatuses.map((s) => ({
    id: s,
    title: "Bank Statements " + s,
    required: true,
    status: s,
  }));

  const vm = buildBorrowerDocumentExperienceViewModel(input(items));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentExperience, { viewModel: vm }),
  );

  // Internal enum tokens must not surface
  for (const enumKey of ["needs_attention", "docs_in_progress", "underwriting_queue"]) {
    assert.ok(
      !html.includes(enumKey),
      `Internal enum "${enumKey}" leaked in rendered HTML`,
    );
  }
});

// ---------------------------------------------------------------------------
// 13. No approval language
// ---------------------------------------------------------------------------

test("rendered experience contains no approval/guarantee/risk-score language", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentExperience, { viewModel: vm }),
  ).toLowerCase();

  const EXTRA_FORBIDDEN = [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "you qualify",
    "you are approved",
    "your loan will",
    "risk score",
    "credit score",
  ];

  for (const term of EXTRA_FORBIDDEN) {
    assert.ok(!html.includes(term), `Approval/guarantee term "${term}" in rendered HTML`);
  }
});

// ---------------------------------------------------------------------------
// 14. No forbidden borrower terms across states
// ---------------------------------------------------------------------------

test("rendered experience contains no forbidden borrower terms across statuses", () => {
  const allStatuses = [
    "missing",
    "uploaded",
    "received",
    "reviewing",
    "accepted",
    "needs_attention",
    "optional",
    "unavailable",
  ] as const;

  const items: BorrowerDocumentItemInput[] = allStatuses.map((s) => ({
    id: s,
    title: "Business Tax Returns " + s,
    required: true,
    status: s,
  }));
  const vm = buildBorrowerDocumentExperienceViewModel(input(items));
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentExperience, { viewModel: vm }),
  ).toLowerCase();

  for (const term of FORBIDDEN_BORROWER_TERMS) {
    assert.ok(
      !html.includes(term.toLowerCase()),
      `Forbidden term "${term}" in rendered HTML`,
    );
  }
});
