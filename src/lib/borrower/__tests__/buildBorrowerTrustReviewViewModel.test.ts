import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerTrustReviewViewModel,
  BORROWER_TRUST_REVIEW_STATE_LABELS,
  type BorrowerTrustReviewInput,
} from "@/lib/borrower/buildBorrowerTrustReviewViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
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
import { buildBorrowerSubmissionReadinessViewModel } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function mkJourney(over: Partial<JourneyInput> = {}) {
  return buildBorrowerJourneyViewModel({
    dealName: "Acme Holdings",
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    portalStage: "additional_items_needed",
    token: "t",
    ...over,
  });
}

function mkGuidance(over: Partial<GuidanceInput> = {}) {
  return buildBorrowerGuidanceViewModel({
    borrowerName: "Jane",
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
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    hasActivity: true,
    recommendationCount: 0,
    portalStage: "additional_items_needed",
    token: "t",
    ...over,
  });
}

function mkComm(over: Partial<CommunicationInput> = {}) {
  return buildBorrowerCommunicationViewModel({
    borrowerName: "Jane",
    token: "t",
    portalStage: "additional_items_needed",
    activity: [],
    blockers: [],
    documents: [],
    recommendations: [],
    ...over,
  });
}

function mkDocs(items: BorrowerDocumentItemInput[]) {
  return buildBorrowerDocumentExperienceViewModel({ token: "t", items });
}

function mkSubmission(opts: {
  docs?: BorrowerDocumentItemInput[];
  portalStage?: JourneyInput["portalStage"];
  commBlockers?: CommunicationInput["blockers"];
} = {}) {
  const docs = opts.docs ?? [
    { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
    { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
  ];
  const portalStage = opts.portalStage ?? "additional_items_needed";
  const documents = mkDocs(docs);
  const journey = mkJourney({ portalStage });
  const guidance = mkGuidance({ portalStage });
  const communication = mkComm({
    portalStage,
    blockers: opts.commBlockers ?? [],
    documents: docs.map((d) => ({
      id: d.id,
      label: d.title,
      status: d.status,
      required: d.required,
    })),
  });
  const submission = buildBorrowerSubmissionReadinessViewModel({
    token: "t",
    journey,
    guidance,
    communication,
    documents,
  });
  return { documents, journey, guidance, communication, submission };
}

function mkInput(over: Partial<BorrowerTrustReviewInput> = {}): BorrowerTrustReviewInput {
  const built = mkSubmission();
  return {
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Minimal fallback
// ---------------------------------------------------------------------------

test("minimal empty state produces not_ready_to_review with valid VM", () => {
  const built = mkSubmission({
    docs: [],
    portalStage: "getting_started",
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  assert.equal(vm.state, "not_ready_to_review");
  assert.ok(vm.headline.length > 0);
  assert.ok(vm.summary.length > 0);
  assert.ok(vm.reviewGroups.length === 5);
  assert.ok(vm.caveatMessage.length > 0);
  assert.equal(vm.packageSummary.requiredReceived, 0);
  assert.equal(vm.packageSummary.categoriesReceived.length, 0);
});

// ---------------------------------------------------------------------------
// 2. ready_to_review derivation
// ---------------------------------------------------------------------------

test("ready_to_review derived when required documents received and no attention", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  assert.equal(vm.state, "ready_to_review");
});

// ---------------------------------------------------------------------------
// 3. confirmations_needed derivation
// ---------------------------------------------------------------------------

test("confirmations_needed derived when an item needs attention", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "needs_attention" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  assert.equal(vm.state, "confirmations_needed");
});

// ---------------------------------------------------------------------------
// 4. waiting_on_updates derivation
// ---------------------------------------------------------------------------

test("waiting_on_updates when remaining required and attention items both exist", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "needs_attention" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  assert.equal(vm.state, "waiting_on_updates");
});

test("waiting_on_updates when communication state is blocked", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
    commBlockers: [{ id: "b1", label: "Critical issue", severity: "critical" }],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  assert.equal(vm.state, "waiting_on_updates");
});

// ---------------------------------------------------------------------------
// 5. Review groups only show real fields
// ---------------------------------------------------------------------------

test("review groups only mark fields available when real values exist", () => {
  const vm = buildBorrowerTrustReviewViewModel(
    mkInput({
      profile: {
        businessLegalName: "Acme LLC",
        primaryContactEmail: "owner@acme.test",
      },
    }),
  );

  const business = vm.reviewGroups.find((g) => g.id === "business_information");
  const legalName = business?.fields.find((f) => f.id === "business_legal_name");
  const dba = business?.fields.find((f) => f.id === "business_dba");

  assert.equal(legalName?.status, "available");
  assert.equal(legalName?.value, "Acme LLC");
  assert.equal(dba?.status, "missing");
  assert.equal(dba?.value, undefined);

  const contact = vm.reviewGroups.find((g) => g.id === "contact_information");
  const email = contact?.fields.find((f) => f.id === "contact_email");
  const phone = contact?.fields.find((f) => f.id === "contact_phone");
  assert.equal(email?.status, "available");
  assert.equal(phone?.status, "missing");
});

// ---------------------------------------------------------------------------
// 6. Missing fields render safely
// ---------------------------------------------------------------------------

test("missing fields have no value and status=missing", () => {
  const vm = buildBorrowerTrustReviewViewModel(
    mkInput({
      borrowerName: null,
      profile: {},
    }),
  );
  const business = vm.reviewGroups.find((g) => g.id === "business_information");
  const dba = business?.fields.find((f) => f.id === "business_dba");
  const address = business?.fields.find((f) => f.id === "business_address");
  assert.equal(dba?.status, "missing");
  assert.equal(dba?.value, undefined);
  assert.equal(address?.status, "missing");
});

test("ownership group falls back to single missing entry when no owners", () => {
  const vm = buildBorrowerTrustReviewViewModel(
    mkInput({
      profile: { owners: [] },
    }),
  );
  const ownership = vm.reviewGroups.find((g) => g.id === "ownership_information");
  assert.ok(ownership);
  assert.equal(ownership.fields.length, 1);
  assert.equal(ownership.fields[0]?.status, "missing");
});

test("ownership group renders each provided owner with percent", () => {
  const vm = buildBorrowerTrustReviewViewModel(
    mkInput({
      profile: {
        owners: [
          { id: "o1", name: "Jane Doe", ownershipPercent: 60 },
          { id: "o2", name: "John Doe", ownershipPercent: 40 },
        ],
      },
    }),
  );
  const ownership = vm.reviewGroups.find((g) => g.id === "ownership_information");
  assert.equal(ownership?.fields.length, 2);
  assert.equal(ownership?.fields[0]?.value, "Jane Doe — 60%");
  assert.equal(ownership?.fields[1]?.value, "John Doe — 40%");
});

// ---------------------------------------------------------------------------
// 7. No fake confirmed status without persistence
// ---------------------------------------------------------------------------

test("confirmation items never default to confirmed when persistence not enabled", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
    profile: {
      businessLegalName: "Acme LLC",
      businessAddress: "1 Main St",
      primaryContactEmail: "owner@acme.test",
      primaryContactPhone: "555-1212",
      owners: [{ id: "o1", name: "Jane Doe", ownershipPercent: 100 }],
      confirmationPersistenceEnabled: false,
    },
  });
  for (const item of vm.confirmationItems) {
    assert.notEqual(item.status, "confirmed");
  }
});

test("confirmation items also do not claim confirmed even when persistence flag is set without real persisted state", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
    profile: {
      businessLegalName: "Acme LLC",
      confirmationPersistenceEnabled: true,
    },
  });
  // Even with the flag set, no persisted confirmation state is supplied via
  // input — VM must NOT invent confirmed status.
  for (const item of vm.confirmationItems) {
    assert.notEqual(item.status, "confirmed");
  }
});

// ---------------------------------------------------------------------------
// 8. Package summary derivation
// ---------------------------------------------------------------------------

test("package summary mirrors document VM counts and reuses submission categories", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  assert.equal(vm.packageSummary.requiredReceived, 2);
  assert.equal(vm.packageSummary.requiredRemaining, 1);
  assert.ok(
    vm.packageSummary.categoriesReceived.includes("Financial documents"),
    "expected Financial documents category",
  );
  assert.equal(
    vm.packageSummary.submissionReadinessLabel,
    built.submission.bandLabel,
  );
});

// ---------------------------------------------------------------------------
// 9. Primary CTA selection
// ---------------------------------------------------------------------------

test("primary CTA omitted entirely when no real href is available anywhere", () => {
  // No missing-required docs (so submission VM has no attention hrefs), and no
  // profile update hrefs. The borrower should NOT see a dead CTA button.
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  assert.equal(vm.primaryCtaHref, undefined);
  assert.equal(vm.primaryCtaLabel, undefined);
});

test("primary CTA points to upload route when there is a missing required document", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
    portalStage: "documents_requested",
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  assert.equal(vm.state, "waiting_on_updates");
  // Submission VM emits /upload/{token} for missing-required items.
  assert.equal(vm.primaryCtaHref, "/upload/t");
});

test("primary CTA uses business update href when reviewing", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
    profile: {
      updateBusinessHref: "/portal/t/business",
    },
  });
  assert.equal(vm.primaryCtaHref, "/portal/t/business");
  assert.ok(vm.primaryCtaLabel && vm.primaryCtaLabel.length > 0);
});

// ---------------------------------------------------------------------------
// 10. Deterministic ordering
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  const input = mkInput({
    profile: {
      businessLegalName: "Acme LLC",
      primaryContactEmail: "owner@acme.test",
      owners: [{ id: "o1", name: "Jane Doe", ownershipPercent: 100 }],
    },
  });
  const a = buildBorrowerTrustReviewViewModel(input);
  const b = buildBorrowerTrustReviewViewModel(input);
  assert.deepStrictEqual(a, b);
});

test("review groups have stable, spec-defined order", () => {
  const vm = buildBorrowerTrustReviewViewModel(mkInput());
  const ids = vm.reviewGroups.map((g) => g.id);
  assert.deepStrictEqual(ids, [
    "business_information",
    "ownership_information",
    "contact_information",
    "financing_context",
    "uploaded_package",
  ]);
});

// ---------------------------------------------------------------------------
// 11. No forbidden terms
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  "credit_memo",
  "lifecycle",
  "underwriting_queue",
  "docs_in_progress",
  "supabase",
  "classifier",
  "extraction failed",
  "parser error",
  "approval odds",
  "guaranteed",
  "approved",
  "conditional approval",
  "pre-approved",
  "probability of approval",
  "risk score",
  "lender acceptance probability",
  "you qualify",
  "your loan will fund",
  "guaranteed funding",
];

function collectText(
  vm: ReturnType<typeof buildBorrowerTrustReviewViewModel>,
): string {
  const parts: string[] = [
    vm.headline,
    vm.summary,
    vm.caveatMessage,
    vm.primaryCtaLabel ?? "",
    ...vm.reviewGroups.flatMap((g) => [
      g.label,
      ...g.fields.flatMap((f) => [f.label, f.value ?? ""]),
    ]),
    ...vm.confirmationItems.flatMap((c) => [c.label, c.description]),
    vm.packageSummary.submissionReadinessLabel,
    ...vm.packageSummary.categoriesReceived,
  ];
  return parts.join(" ").toLowerCase();
}

test("no forbidden terms across multiple states", () => {
  const scenarios: BorrowerTrustReviewInput[] = [
    mkInput(),
    (() => {
      const built = mkSubmission({
        docs: [
          { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
        ],
      });
      return {
        token: "t",
        borrowerName: "Jane",
        journey: built.journey,
        guidance: built.guidance,
        communication: built.communication,
        documents: built.documents,
        submission: built.submission,
      };
    })(),
    (() => {
      const built = mkSubmission({ docs: [], portalStage: "getting_started" });
      return {
        token: "t",
        borrowerName: "Jane",
        journey: built.journey,
        guidance: built.guidance,
        communication: built.communication,
        documents: built.documents,
        submission: built.submission,
      };
    })(),
  ];
  for (const input of scenarios) {
    const text = collectText(buildBorrowerTrustReviewViewModel(input));
    for (const term of FORBIDDEN) {
      assert.ok(
        !text.includes(term.toLowerCase()),
        `Forbidden term "${term}" in: ${text}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 12. No approval / funding language
// ---------------------------------------------------------------------------

test("no approval/funding/guarantee language", () => {
  const built = mkSubmission({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey: built.journey,
    guidance: built.guidance,
    communication: built.communication,
    documents: built.documents,
    submission: built.submission,
  });
  const text = collectText(vm);
  for (const phrase of [
    "you are approved",
    "your loan will",
    "guaranteed funding",
    "pre-approved",
    "credit decision",
  ]) {
    assert.ok(!text.includes(phrase), `Approval phrase "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// 13. No fake timestamps
// ---------------------------------------------------------------------------

test("VM does not emit any timestamps", () => {
  const vm = buildBorrowerTrustReviewViewModel(
    mkInput({
      profile: {
        businessLegalName: "Acme LLC",
        primaryContactEmail: "owner@acme.test",
      },
    }),
  );
  // Spec forbids invented timestamps. Confirm no field or item carries one.
  const serialized = JSON.stringify(vm);
  // Crude check: no ISO 8601 date strings
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(serialized), false);
});

// ---------------------------------------------------------------------------
// 14. State labels match spec verbatim
// ---------------------------------------------------------------------------

test("state labels match spec borrower-facing labels", () => {
  assert.equal(
    BORROWER_TRUST_REVIEW_STATE_LABELS.not_ready_to_review,
    "Not ready for review yet",
  );
  assert.equal(
    BORROWER_TRUST_REVIEW_STATE_LABELS.ready_to_review,
    "Ready to review",
  );
  assert.equal(
    BORROWER_TRUST_REVIEW_STATE_LABELS.confirmations_needed,
    "Confirm a few details",
  );
  assert.equal(BORROWER_TRUST_REVIEW_STATE_LABELS.reviewed, "Review saved");
  assert.equal(
    BORROWER_TRUST_REVIEW_STATE_LABELS.waiting_on_updates,
    "Waiting on updates",
  );
});

// ---------------------------------------------------------------------------
// 15. Caveat content
// ---------------------------------------------------------------------------

test("caveat message references package preparation and not a lending decision", () => {
  const vm = buildBorrowerTrustReviewViewModel(mkInput());
  const caveat = vm.caveatMessage.toLowerCase();
  assert.ok(caveat.includes("package"));
  assert.ok(caveat.includes("banker"));
});
