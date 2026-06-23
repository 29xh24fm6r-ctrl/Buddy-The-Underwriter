import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerDealHealthViewModel,
  type DealHealthInput,
} from "@/lib/borrower/buildBorrowerDealHealthViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<DealHealthInput> = {}): DealHealthInput {
  return {
    borrowerName: "Jane Doe",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsVerified: 3,
    docsInFlight: false,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    sbaFormsReceived: 1,
    sbaFormsRequired: 2,
    blockerCount: 2,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
      { id: "m2", title: "Voided Business Check", required: true },
      { id: "m3", title: "Debt Schedule", required: false },
    ],
    completedItems: [
      { id: "c1", title: "Personal Financial Statement" },
      { id: "c2", title: "Business License" },
    ],
    financialDocTypes: ["Tax Return", "P&L"],
    financialPeriods: ["2023", "2024 YTD"],
    extractedFinancialFields: ["revenue", "net_income"],
    portalStage: "additional_items_needed",
    token: "test-token",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Category score derivation
// ---------------------------------------------------------------------------

test("produces exactly 6 categories", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  assert.equal(vm.categories.length, 6);
  const ids = vm.categories.map((c) => c.id);
  assert.ok(ids.includes("documents"));
  assert.ok(ids.includes("financials"));
  assert.ok(ids.includes("sba_forms"));
  assert.ok(ids.includes("ownership"));
  assert.ok(ids.includes("profile"));
  assert.ok(ids.includes("attention"));
});

test("document category score reflects checklist ratio", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({ checklistReceived: 6, checklistRequired: 6, checklistMissing: 0 }),
  );
  const doc = vm.categories.find((c) => c.id === "documents")!;
  assert.ok(doc.score != null);
  assert.equal(doc.score, 100);
  assert.equal(doc.status, "strong");
});

test("financial category reflects financial doc presence", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  const fin = vm.categories.find((c) => c.id === "financials")!;
  assert.equal(fin.status, "strong");
  assert.ok(fin.score != null);
});

test("ownership category reflects verification state", () => {
  const unverified = buildBorrowerDealHealthViewModel(baseInput({ ownershipVerified: false }));
  const verified = buildBorrowerDealHealthViewModel(baseInput({ ownershipVerified: true }));
  assert.notEqual(
    unverified.categories.find((c) => c.id === "ownership")!.status,
    "strong",
  );
  assert.equal(
    verified.categories.find((c) => c.id === "ownership")!.status,
    "strong",
  );
});

// ---------------------------------------------------------------------------
// 2. Missing data produces unavailable/low-confidence state
// ---------------------------------------------------------------------------

test("zero checklistRequired produces unavailable document category", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({ checklistRequired: 0, checklistReceived: 0, checklistMissing: 0 }),
  );
  const doc = vm.categories.find((c) => c.id === "documents")!;
  assert.equal(doc.status, "unavailable");
  assert.equal(doc.confidence, "low");
});

test("zero sbaFormsRequired produces unavailable SBA category", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({ sbaFormsRequired: 0, sbaFormsReceived: 0 }),
  );
  const sba = vm.categories.find((c) => c.id === "sba_forms")!;
  assert.equal(sba.status, "unavailable");
});

test("no financial docs produces not_started financial category", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({ financialDocTypes: [], financialPeriods: [], extractedFinancialFields: [] }),
  );
  const fin = vm.categories.find((c) => c.id === "financials")!;
  assert.equal(fin.status, "not_started");
  assert.equal(fin.confidence, "low");
});

// ---------------------------------------------------------------------------
// 3. No fake financial snapshot when financial data absent
// ---------------------------------------------------------------------------

test("financial snapshot unavailable when no financial data", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({ financialDocTypes: [], financialPeriods: [], extractedFinancialFields: [] }),
  );
  assert.equal(vm.financialSnapshot.available, false);
  assert.ok(vm.financialSnapshot.summary.includes("after Buddy reviews"));
  assert.equal(vm.financialSnapshot.periodsCovered, undefined);
  assert.equal(vm.financialSnapshot.receivedStatementTypes, undefined);
  assert.equal(vm.financialSnapshot.extractedFields, undefined);
});

test("financial snapshot available when financial data exists", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  assert.equal(vm.financialSnapshot.available, true);
  assert.ok(vm.financialSnapshot.receivedStatementTypes!.length > 0);
  assert.ok(vm.financialSnapshot.periodsCovered!.length > 0);
  assert.ok(vm.financialSnapshot.extractedFields!.length > 0);
});

// ---------------------------------------------------------------------------
// 4. Reviewer preview only includes backed-by-state items
// ---------------------------------------------------------------------------

test("reviewer preview includes strengths from real state", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  const strengths = vm.reviewerPreview.filter((i) => i.type === "strength");
  assert.ok(strengths.length > 0);
  // Should include docs received
  assert.ok(strengths.some((s) => s.label.includes("received")));
});

test("reviewer preview includes needed items from missing required docs", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  const needed = vm.reviewerPreview.filter((i) => i.type === "needed");
  assert.ok(needed.length > 0);
});

test("reviewer preview fallback when no data at all", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({
      checklistReceived: 0,
      checklistMissing: 0,
      docsUploaded: 0,
      docsVerified: 0,
      ownershipVerified: false,
      financialDocTypes: [],
      profileCompleteness: 0,
      missingItems: [],
    }),
  );
  assert.ok(vm.reviewerPreview.length > 0);
  assert.ok(vm.reviewerPreview[0].label.includes("getting started"));
});

// ---------------------------------------------------------------------------
// 5. Attention item grouping/prioritization
// ---------------------------------------------------------------------------

test("attention items include required missing docs", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  const required = vm.attentionItems.filter((i) => i.priority === "required");
  assert.ok(required.length >= 2);
  assert.ok(required[0].href?.includes("/upload/"));
});

test("attention items include helpful profile/ownership items", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({ profileCompleteness: 0.3, ownershipVerified: false }),
  );
  const helpful = vm.attentionItems.filter((i) => i.priority === "helpful");
  assert.ok(helpful.length >= 2);
});

test("attention items include optional non-required docs", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  const optional = vm.attentionItems.filter((i) => i.priority === "optional");
  assert.ok(optional.length > 0);
});

// ---------------------------------------------------------------------------
// 6. Internal lifecycle/status terms do not leak
// ---------------------------------------------------------------------------

test("no forbidden terms in deal health view model copy", () => {
  const FORBIDDEN = [
    "docs_in_progress",
    "credit_memo",
    "lifecycle",
    "supabase",
    "underwriting_queue",
    "approval odds",
    "guaranteed",
    "approved",
    "probability of approval",
    "readiness_regressed",
    "underwriting_score",
    "trident_failure",
    "OCR confidence",
    "lender_match_status",
    "banker notes",
    "credit score",
  ];

  const stages: DealHealthInput["portalStage"][] = [
    "getting_started",
    "documents_requested",
    "buddy_reviewing",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const vm = buildBorrowerDealHealthViewModel(baseInput({ portalStage: stage }));
    const allText = [
      vm.summary,
      ...vm.categories.map((c) => `${c.label} ${c.summary}`),
      ...vm.reviewerPreview.map((r) => `${r.label} ${r.description ?? ""}`),
      vm.financialSnapshot.summary,
      ...vm.attentionItems.map((a) => `${a.label} ${a.description ?? ""}`),
    ].join(" ");

    for (const term of FORBIDDEN) {
      assert.ok(
        !allText.toLowerCase().includes(term.toLowerCase()),
        `Forbidden term "${term}" found in stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 7. Empty state remains useful
// ---------------------------------------------------------------------------

test("minimal input produces valid view model with useful summary", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({
      checklistRequired: 0,
      checklistReceived: 0,
      checklistMissing: 0,
      docsUploaded: 0,
      docsVerified: 0,
      profileCompleteness: 0,
      ownershipVerified: false,
      sbaFormsRequired: 0,
      sbaFormsReceived: 0,
      blockerCount: 0,
      missingItems: [],
      completedItems: [],
      financialDocTypes: [],
      financialPeriods: [],
      extractedFinancialFields: [],
      portalStage: "getting_started",
    }),
  );
  assert.equal(vm.categories.length, 6);
  assert.ok(vm.summary.length > 0);
  assert.ok(vm.reviewerPreview.length > 0);
  assert.equal(vm.financialSnapshot.available, false);
});

// ---------------------------------------------------------------------------
// 8. Backward compatibility with minimal inputs
// ---------------------------------------------------------------------------

test("summary includes borrower name when provided", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  assert.ok(vm.summary.includes("Jane"));
});

test("summary works without borrower name", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput({ borrowerName: null }));
  assert.ok(vm.summary.includes("Your"));
  assert.ok(!vm.summary.includes("null"));
});

// ---------------------------------------------------------------------------
// 9. No fake financial values
// ---------------------------------------------------------------------------

test("financial snapshot never contains fabricated numbers", () => {
  const vm = buildBorrowerDealHealthViewModel(baseInput());
  const snap = vm.financialSnapshot;
  // Should only contain doc type names, period labels, field names — not dollar amounts
  const allSnapText = [
    snap.summary,
    ...(snap.receivedStatementTypes ?? []),
    ...(snap.periodsCovered ?? []),
    ...(snap.extractedFields ?? []),
  ].join(" ");

  // No dollar signs, no numbers that look like financial values
  assert.ok(
    !allSnapText.includes("$"),
    "Financial snapshot should not contain dollar signs",
  );
  // Allowed: count numbers like "2 financial" — but not "$100,000" patterns
  assert.ok(
    !/\$[\d,]+/.test(allSnapText),
    "Financial snapshot should not contain dollar amounts",
  );
});

// ---------------------------------------------------------------------------
// 10. Category confidence levels
// ---------------------------------------------------------------------------

test("categories with data have higher confidence than those without", () => {
  const vm = buildBorrowerDealHealthViewModel(
    baseInput({ financialDocTypes: [], extractedFinancialFields: [] }),
  );
  const docCat = vm.categories.find((c) => c.id === "documents")!;
  const finCat = vm.categories.find((c) => c.id === "financials")!;
  assert.equal(docCat.confidence, "high"); // has checklist data
  assert.equal(finCat.confidence, "low"); // no financial data
});
