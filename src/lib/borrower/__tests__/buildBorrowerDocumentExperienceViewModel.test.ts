import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerDocumentExperienceViewModel,
  type DocumentExperienceInput,
  type BorrowerDocumentItemInput,
} from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function input(
  items: BorrowerDocumentItemInput[],
  overrides: Partial<DocumentExperienceInput> = {},
): DocumentExperienceInput {
  return {
    token: "test-token",
    items,
    ...overrides,
  };
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
      title: "Personal Tax Returns",
      required: true,
      group: "Tax Returns",
      status: "received",
    },
    {
      id: "i3",
      title: "Balance Sheet",
      required: true,
      group: "Financial Statements",
      status: "missing",
    },
    {
      id: "i4",
      title: "SBA Form 1919",
      required: true,
      group: "SBA Forms",
      status: "missing",
    },
    {
      id: "i5",
      title: "Personal Financial Statement",
      required: true,
      group: "SBA Forms",
      status: "accepted",
    },
    {
      id: "i6",
      title: "Driver's License",
      required: true,
      group: "Identity",
      status: "missing",
    },
    {
      id: "i7",
      title: "Operating Agreement",
      required: true,
      group: "Ownership",
      status: "received",
    },
    {
      id: "i8",
      title: "Current Lease",
      required: false,
      group: "Business Documents",
      status: "missing",
    },
    {
      id: "i9",
      title: "Insurance Documents",
      required: false,
      group: "Business Documents",
      status: "needs_attention",
    },
  ];
}

// ---------------------------------------------------------------------------
// 1. Grouping by category
// ---------------------------------------------------------------------------

test("groups items by borrower-friendly category", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  const groupIds = vm.groups.map((g) => g.id);

  // The defined order is fixed; only groups with items should appear
  assert.deepEqual(groupIds, [
    "business_financials",
    "tax_returns",
    "sba_forms",
    "ownership_identity",
    "business_documents",
  ]);
});

test("tax returns and SBA forms classify correctly even with mixed input groups", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      { id: "t1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "s1", title: "SBA Form 1919", required: true, status: "missing" },
      { id: "p1", title: "SBA Form 413", required: true, status: "missing" },
    ]),
  );

  const tax = vm.groups.find((g) => g.id === "tax_returns");
  const sba = vm.groups.find((g) => g.id === "sba_forms");
  assert.ok(tax);
  assert.equal(tax.requirements.length, 1);
  assert.ok(sba);
  assert.equal(sba.requirements.length, 2);
});

// ---------------------------------------------------------------------------
// 2. Required received / remaining counts
// ---------------------------------------------------------------------------

test("package summary counts required received and remaining correctly", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));

  // 7 required total; 3 received (received/accepted): i2, i5, i7
  assert.equal(vm.packageSummary.requiredTotal, 7);
  assert.equal(vm.packageSummary.requiredReceived, 3);
  assert.equal(vm.packageSummary.requiredRemaining, 4);
});

// ---------------------------------------------------------------------------
// 3. Optional received count
// ---------------------------------------------------------------------------

test("optional received count tracks non-required items", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "o1",
        title: "Current Lease",
        required: false,
        status: "received",
      },
      {
        id: "o2",
        title: "Insurance Documents",
        required: false,
        status: "missing",
      },
    ]),
  );
  assert.equal(vm.packageSummary.optionalReceived, 1);
});

// ---------------------------------------------------------------------------
// 4. Needs-attention counts
// ---------------------------------------------------------------------------

test("needs-attention count aggregates across all items", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  assert.equal(vm.packageSummary.needsAttention, 1);

  const businessDocs = vm.groups.find((g) => g.id === "business_documents");
  assert.ok(businessDocs);
  assert.equal(businessDocs.needsAttentionCount, 1);
});

// ---------------------------------------------------------------------------
// 5. Missing-item guidance mapping
// ---------------------------------------------------------------------------

test("missing tax return resolves to coaching map guidance", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      { id: "t1", title: "Business Tax Returns", required: true, status: "missing" },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  assert.equal(req.guidance.label, "Business tax returns");
  assert.match(req.guidance.whyItMatters, /primary evidence/i);
  assert.match(req.guidance.helpfulUploadHint, /signed federal return/i);
});

test("guidance map covers expected document types", () => {
  const titles = [
    "Business Tax Returns",
    "Personal Tax Returns",
    "YTD Profit & Loss",
    "Balance Sheet",
    "Debt Schedule",
    "Bank Statements",
    "SBA Form 1919",
    "SBA Form 413",
    "Driver's License",
    "Operating Agreement",
    "Current Lease",
    "Purchase Agreement",
    "Franchise Agreement",
    "Payroll Reports",
    "Insurance Documents",
  ];
  for (const title of titles) {
    const vm = buildBorrowerDocumentExperienceViewModel(
      input([{ id: title, title, required: true, status: "missing" }]),
    );
    const req = vm.groups[0]?.requirements[0];
    assert.ok(req, `expected requirement for ${title}`);
    assert.ok(
      req.guidance.label.length > 0 && req.guidance.label !== "Requested document",
      `expected guidance for ${title}, got fallback`,
    );
    assert.ok(req.guidance.whyItMatters.length > 0);
    assert.ok(req.guidance.helpfulUploadHint.length > 0);
  }
});

// ---------------------------------------------------------------------------
// 6. Duplicate / latest upload handling
// ---------------------------------------------------------------------------

test("latestUploadedAt and uploadCount surface in requirement", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "u1",
        title: "Business Tax Returns",
        required: true,
        status: "received",
        uploadCount: 2,
        latestUploadedAt: "2026-05-10T12:00:00Z",
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  assert.equal(req.latestUploadedAt, "2026-05-10T12:00:00Z");
  assert.equal(req.uploadCount, 2);
});

// ---------------------------------------------------------------------------
// 7. Replacement CTA when already uploaded
// ---------------------------------------------------------------------------

test("replacement CTA appears when item already uploaded", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "u1",
        title: "Business Tax Returns",
        required: true,
        status: "received",
        uploadCount: 1,
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  assert.equal(req.ctaLabel, "Upload updated version");
});

test("accepted items have no replacement CTA", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "u1",
        title: "Business Tax Returns",
        required: true,
        status: "accepted",
        uploadCount: 1,
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  assert.equal(req.ctaLabel, undefined);
});

// ---------------------------------------------------------------------------
// 8. Recovery message for needs_attention
// ---------------------------------------------------------------------------

test("needs_attention items include a calm recovery message", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "n1",
        title: "Business Tax Returns",
        required: true,
        status: "needs_attention",
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  assert.ok(req.recoveryMessage && req.recoveryMessage.length > 0);
  assert.match(req.recoveryMessage, /clearer copy|all pages|complete version/i);
});

test("non-attention items do not surface recovery messaging", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "n1",
        title: "Business Tax Returns",
        required: true,
        status: "received",
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  assert.equal(req.recoveryMessage, undefined);
});

// ---------------------------------------------------------------------------
// 9. Reassurance copy gated on status
// ---------------------------------------------------------------------------

test("reassurance copy appears only when state supports it", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "r1",
        title: "Bank Statements",
        required: true,
        status: "received",
      },
      {
        id: "r2",
        title: "Debt Schedule",
        required: true,
        status: "missing",
      },
    ]),
  );

  const received = vm.groups.flatMap((g) => g.requirements).find((r) => r.id === "r1");
  const missing = vm.groups.flatMap((g) => g.requirements).find((r) => r.id === "r2");
  assert.ok(received?.reassurance && received.reassurance.length > 0);
  assert.equal(missing?.reassurance, undefined);
});

// ---------------------------------------------------------------------------
// 10. Safe fallback for unknown doc types
// ---------------------------------------------------------------------------

test("unknown document type falls back to a generic-but-safe guidance block", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      {
        id: "x1",
        title: "Wholly Unfamiliar Document Name",
        required: true,
        status: "missing",
      },
    ]),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.ok(req);
  assert.equal(req.label, "Wholly Unfamiliar Document Name");
  assert.ok(req.guidance.whyItMatters.length > 0);
  assert.ok(req.guidance.helpfulUploadHint.length > 0);
});

// ---------------------------------------------------------------------------
// 11. Deterministic ordering
// ---------------------------------------------------------------------------

test("same input produces identical view model", () => {
  const items = baseItems();
  const vm1 = buildBorrowerDocumentExperienceViewModel(input(items));
  const vm2 = buildBorrowerDocumentExperienceViewModel(input(items));
  assert.deepStrictEqual(vm1, vm2);
});

test("requirements within a group are sorted required-first, status, then label", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      { id: "a", title: "Lease — Newer", required: false, status: "received" },
      { id: "b", title: "Lease — Older", required: true, status: "needs_attention" },
      { id: "c", title: "Lease — Middle", required: true, status: "missing" },
    ]),
  );
  const group = vm.groups.find((g) => g.id === "business_documents");
  assert.ok(group);
  // Required first; needs_attention before missing
  assert.equal(group.requirements[0]?.id, "b");
  assert.equal(group.requirements[1]?.id, "c");
  assert.equal(group.requirements[2]?.id, "a");
});

// ---------------------------------------------------------------------------
// 12. Primary attention items capped
// ---------------------------------------------------------------------------

test("primary attention items are capped at default 3", () => {
  const many: BorrowerDocumentItemInput[] = Array.from({ length: 8 }, (_, i) => ({
    id: `m${i}`,
    title: `Bank Statements ${i}`,
    required: true,
    status: "missing",
  }));
  const vm = buildBorrowerDocumentExperienceViewModel(input(many));
  assert.equal(vm.primaryAttentionItems.length, 3);
});

test("primary attention cap respects override", () => {
  const many: BorrowerDocumentItemInput[] = Array.from({ length: 5 }, (_, i) => ({
    id: `m${i}`,
    title: `Bank Statements ${i}`,
    required: true,
    status: "missing",
  }));
  const vm = buildBorrowerDocumentExperienceViewModel(
    input(many, { maxPrimaryAttention: 2 }),
  );
  assert.equal(vm.primaryAttentionItems.length, 2);
});

test("primary attention prioritizes needs_attention then required missing", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input(baseItems()));
  // i9 is needs_attention so it should be first
  assert.equal(vm.primaryAttentionItems[0]?.id, "i9");
  // After that, required missing items
  const top = vm.primaryAttentionItems.slice(1).map((r) => r.id);
  for (const id of top) {
    const item = baseItems().find((i) => i.id === id);
    assert.ok(item);
    assert.equal(item.required, true);
  }
});

// ---------------------------------------------------------------------------
// 13. Empty input safety
// ---------------------------------------------------------------------------

test("empty input produces a valid empty view model", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(input([]));
  assert.equal(vm.groups.length, 0);
  assert.equal(vm.primaryAttentionItems.length, 0);
  assert.equal(vm.packageSummary.requiredTotal, 0);
  assert.equal(vm.packageSummary.requiredReceived, 0);
  assert.equal(vm.packageSummary.requiredRemaining, 0);
  assert.equal(vm.packageSummary.needsAttention, 0);
  assert.ok(vm.packageSummary.summary.length > 0);
});

// ---------------------------------------------------------------------------
// 14. Upload links point at the borrower upload page
// ---------------------------------------------------------------------------

test("CTAs link to /upload/{token} when an action is available", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input(
      [
        { id: "a", title: "Business Tax Returns", required: true, status: "missing" },
      ],
      { token: "abc-123" },
    ),
  );
  const req = vm.groups[0]?.requirements[0];
  assert.equal(req?.href, "/upload/abc-123");
});

test("no CTA href when status is accepted or unavailable", () => {
  const vm = buildBorrowerDocumentExperienceViewModel(
    input([
      { id: "a", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "b", title: "Insurance Documents", required: false, status: "unavailable" },
    ]),
  );
  const reqs = vm.groups.flatMap((g) => g.requirements);
  for (const r of reqs) {
    assert.equal(r.href, undefined);
  }
});

// ---------------------------------------------------------------------------
// 15. Status label translation (no internal terms)
// ---------------------------------------------------------------------------

test("status labels render in borrower-safe plain English", () => {
  const statuses = [
    "missing",
    "uploaded",
    "received",
    "reviewing",
    "accepted",
    "needs_attention",
    "optional",
    "unavailable",
  ] as const;

  for (const status of statuses) {
    const vm = buildBorrowerDocumentExperienceViewModel(
      input([{ id: status, title: "Bank Statements", required: true, status }]),
    );
    const req = vm.groups[0]?.requirements[0];
    assert.ok(req);
    assert.ok(
      !/failed|classifier|extraction|lifecycle|underwriting/i.test(req.statusLabel),
      `unsafe status label "${req.statusLabel}" for status "${status}"`,
    );
    assert.ok(req.statusLabel.length > 0);
  }
});

// ---------------------------------------------------------------------------
// 16. No forbidden borrower-facing terms in any rendered VM text
// ---------------------------------------------------------------------------

const FORBIDDEN_TERMS = [
  "docs_in_progress",
  "lifecycle",
  "credit_memo",
  "supabase",
  "underwriting_queue",
  "classifier",
  "extraction failed",
  "parser error",
  "approval odds",
  "guaranteed",
  "probability of approval",
  "risk score",
];

function collectVMText(
  vm: ReturnType<typeof buildBorrowerDocumentExperienceViewModel>,
): string {
  const parts: string[] = [];
  parts.push(vm.packageSummary.summary);
  for (const g of vm.groups) {
    parts.push(g.label, g.description);
    for (const r of g.requirements) {
      parts.push(
        r.label,
        r.statusLabel,
        r.guidance.label,
        r.guidance.whyItMatters,
        r.guidance.helpfulUploadHint,
        r.guidance.commonIssueToAvoid ?? "",
        r.guidance.acceptedFormatsCopy ?? "",
        r.ctaLabel ?? "",
        r.reassurance ?? "",
        r.recoveryMessage ?? "",
      );
    }
  }
  for (const r of vm.primaryAttentionItems) {
    parts.push(r.label, r.statusLabel, r.reassurance ?? "", r.recoveryMessage ?? "");
  }
  return parts.join(" ");
}

test("no forbidden borrower-facing terms across all statuses", () => {
  const statuses = [
    "missing",
    "uploaded",
    "received",
    "reviewing",
    "accepted",
    "needs_attention",
    "optional",
    "unavailable",
  ] as const;

  const items: BorrowerDocumentItemInput[] = statuses.map((status) => ({
    id: status,
    title: "Bank Statements",
    required: true,
    status,
  }));
  const vm = buildBorrowerDocumentExperienceViewModel(input(items));
  const text = collectVMText(vm).toLowerCase();

  for (const term of FORBIDDEN_TERMS) {
    assert.ok(
      !text.includes(term.toLowerCase()),
      `Forbidden term "${term}" appeared in view model output`,
    );
  }
});
