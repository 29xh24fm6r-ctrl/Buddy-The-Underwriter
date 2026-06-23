import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBankerCommandCenterViewModel,
  BANKER_COMMAND_CENTER_SECTION_ORDER,
  BANKER_COMMAND_CENTER_PRIORITY_LABELS,
  BANKER_COMMAND_CENTER_STALENESS_LABELS,
  type BankerCommandCenterDealInput,
  type BankerCommandCenterInput,
} from "@/lib/banker/buildBankerCommandCenterViewModel";
import {
  buildBorrowerOperationalContinuityViewModel,
  type BorrowerOperationalContinuityInput,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
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
import { buildBorrowerMobileCommandViewModel } from "@/lib/borrower/buildBorrowerMobileCommandViewModel";
import { buildBorrowerSubmissionReadinessViewModel } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";
import { buildBorrowerTrustReviewViewModel } from "@/lib/borrower/buildBorrowerTrustReviewViewModel";
import {
  buildBorrowerDealHealthViewModel,
  type DealHealthInput,
} from "@/lib/borrower/buildBorrowerDealHealthViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PortalStage = JourneyInput["portalStage"];

function buildContinuity(opts: {
  dealId: string;
  docs?: BorrowerDocumentItemInput[];
  portalStage?: PortalStage;
  blockers?: CommunicationInput["blockers"];
}) {
  const docs = opts.docs ?? [
    { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
    { id: "d2", title: "Balance Sheet", required: true, status: "received" },
  ];
  const portalStage = opts.portalStage ?? "additional_items_needed";
  const documents = buildBorrowerDocumentExperienceViewModel({ token: opts.dealId, items: docs });
  const journey = buildBorrowerJourneyViewModel({
    dealName: "Acme",
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    portalStage,
    token: opts.dealId,
  });
  const readiness = buildBorrowerReadinessViewModel({
    borrowerName: "Jane",
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
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    activity: [],
    portalStage,
    token: opts.dealId,
  });
  const dealHealth = buildBorrowerDealHealthViewModel({
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsVerified: 3,
    docsInFlight: false,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    sbaFormsReceived: 0,
    sbaFormsRequired: 0,
    blockerCount: 2,
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    financialDocTypes: [],
    financialPeriods: [],
    extractedFinancialFields: [],
    portalStage,
    token: opts.dealId,
  } satisfies DealHealthInput);
  const guidance = buildBorrowerGuidanceViewModel({
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
    portalStage,
    token: opts.dealId,
  } satisfies GuidanceInput);
  const communication = buildBorrowerCommunicationViewModel({
    borrowerName: "Jane",
    token: opts.dealId,
    portalStage,
    activity: [],
    blockers: opts.blockers ?? [],
    documents: docs.map((d) => ({
      id: d.id,
      label: d.title,
      status: d.status,
      required: d.required,
    })),
    recommendations: [],
  });
  const submission = buildBorrowerSubmissionReadinessViewModel({
    token: opts.dealId,
    journey,
    guidance,
    communication,
    documents,
  });
  const mobileCommand = buildBorrowerMobileCommandViewModel({
    borrowerName: "Jane",
    token: opts.dealId,
    journey,
    readiness,
    guidance,
    communication,
    documents,
  });
  const trustReview = buildBorrowerTrustReviewViewModel({
    token: opts.dealId,
    borrowerName: "Jane",
    journey,
    readiness,
    guidance,
    communication,
    documents,
    mobileCommand,
    submission,
  });
  const input: BorrowerOperationalContinuityInput = {
    dealId: opts.dealId,
    borrowerName: "Jane",
    businessName: "Acme",
    journey,
    readiness,
    dealHealth,
    guidance,
    documents,
    communication,
    mobileCommand,
    submission,
    trustReview,
  };
  return buildBorrowerOperationalContinuityViewModel(input);
}

function deal(
  dealId: string,
  opts: Parameters<typeof buildContinuity>[0] & {
    borrowerLabel?: string;
    lastActivityAt?: string;
    topBlocker?: string;
    href?: string;
  } = { dealId: "d-1" },
): BankerCommandCenterDealInput {
  const continuity = buildContinuity({ ...opts, dealId });
  const out: BankerCommandCenterDealInput = {
    dealId,
    borrowerLabel: opts.borrowerLabel ?? `Borrower ${dealId}`,
    continuity,
  };
  if (opts.lastActivityAt) out.lastActivityAt = opts.lastActivityAt;
  if (opts.topBlocker) out.topBlocker = opts.topBlocker;
  if (opts.href) out.href = opts.href;
  return out;
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

test("empty input produces empty VM with zero summary", () => {
  const vm = buildBankerCommandCenterViewModel({ deals: [] });
  assert.equal(vm.summary.totalDeals, 0);
  assert.equal(vm.summary.bankerActionRequired, 0);
  assert.equal(vm.sections.length, 0);
  assert.equal(vm.recentlyActive.length, 0);
});

// ---------------------------------------------------------------------------
// 2. Queue categorization from handoff state
// ---------------------------------------------------------------------------

test("queue categories map from continuity handoffState", () => {
  const deals: BankerCommandCenterDealInput[] = [
    // ready_for_submission_prep (all received)
    deal("d-1", {
      dealId: "d-1",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
      ],
    }),
    // borrower_blocked
    deal("d-2", {
      dealId: "d-2",
      blockers: [{ id: "b1", label: "Critical", severity: "critical" }],
    }),
    // waiting_on_borrower (default missing scenario)
    deal("d-3", { dealId: "d-3" }),
    // needs_clarification (needs_attention)
    deal("d-4", {
      dealId: "d-4",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "received" },
        { id: "y", title: "Balance Sheet", required: true, status: "needs_attention" },
      ],
    }),
  ];
  const vm = buildBankerCommandCenterViewModel({ deals });
  const categoriesById = new Map(
    vm.sections.flatMap((s) => s.items.map((i) => [i.dealId, i.queueCategory] as const)),
  );
  assert.equal(categoriesById.get("d-1"), "ready_for_submission_prep");
  assert.equal(categoriesById.get("d-2"), "operationally_blocked");
  assert.equal(categoriesById.get("d-3"), "borrower_action_required");
  assert.equal(categoriesById.get("d-4"), "needs_clarification");
});

// ---------------------------------------------------------------------------
// 3. Priority band derivation
// ---------------------------------------------------------------------------

test("priority bands derive operationally from handoffState", () => {
  const deals = [
    deal("d-blocked", {
      dealId: "d-blocked",
      blockers: [{ id: "b1", label: "Critical", severity: "critical" }],
    }),
    deal("d-ready", {
      dealId: "d-ready",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
      ],
    }),
    deal("d-waiting", { dealId: "d-waiting" }),
  ];
  const vm = buildBankerCommandCenterViewModel({ deals });
  const bandsById = new Map(
    vm.sections.flatMap((s) => s.items.map((i) => [i.dealId, i.priorityBand] as const)),
  );
  assert.equal(bandsById.get("d-blocked"), "immediate_attention");
  assert.equal(bandsById.get("d-ready"), "active_review");
  assert.equal(bandsById.get("d-waiting"), "waiting_on_borrower");
});

// ---------------------------------------------------------------------------
// 4. Banker action prioritization — within section, more attention sorts first
// ---------------------------------------------------------------------------

test("within section, more remaining items sort first", () => {
  const deals = [
    // d-a: 1 missing, 1 received → handoff = waiting_on_borrower
    deal("d-a", {
      dealId: "d-a",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "missing" },
        { id: "y", title: "Balance Sheet", required: true, status: "received" },
      ],
    }),
    // d-b: 3 missing, 1 received → also waiting_on_borrower (some received)
    deal("d-b", {
      dealId: "d-b",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "missing" },
        { id: "y", title: "Balance Sheet", required: true, status: "missing" },
        { id: "z", title: "SBA Form 1919", required: true, status: "missing" },
        { id: "w", title: "Personal Financial Statement", required: true, status: "received" },
      ],
    }),
  ];
  const vm = buildBankerCommandCenterViewModel({ deals });
  const borrowerSection = vm.sections.find((s) => s.id === "borrower_action_required");
  assert.ok(borrowerSection);
  // d-b has 3 remaining, d-a has 1 — d-b should be first.
  assert.equal(borrowerSection.items[0]?.dealId, "d-b");
  assert.equal(borrowerSection.items[1]?.dealId, "d-a");
});

// ---------------------------------------------------------------------------
// 5. Stalled-state derivation only when evaluatedAt provided
// ---------------------------------------------------------------------------

test("stalled state is omitted when evaluatedAt missing", () => {
  const deals = [
    deal("d-old", {
      dealId: "d-old",
      lastActivityAt: "2026-04-01T00:00:00.000Z",
    }),
  ];
  const vm = buildBankerCommandCenterViewModel({ deals });
  for (const section of vm.sections) {
    for (const item of section.items) {
      assert.equal(item.staleness, undefined);
      assert.equal(item.daysSinceLastActivity, undefined);
    }
  }
});

test("stalled deals move from borrower_action_required → stalled when evaluatedAt distant", () => {
  const deals = [
    deal("d-old", {
      dealId: "d-old",
      lastActivityAt: "2026-04-01T00:00:00.000Z",
    }),
  ];
  const vm = buildBankerCommandCenterViewModel({
    deals,
    evaluatedAt: "2026-05-20T00:00:00.000Z",
  });
  const stalledSection = vm.sections.find((s) => s.id === "stalled");
  assert.ok(stalledSection);
  assert.equal(stalledSection.items[0]?.dealId, "d-old");
  assert.equal(stalledSection.items[0]?.staleness, "stalled");
  assert.ok((stalledSection.items[0]?.daysSinceLastActivity ?? 0) >= 7);
});

test("recently active deals get recently_active staleness label", () => {
  const deals = [
    deal("d-fresh", {
      dealId: "d-fresh",
      lastActivityAt: "2026-05-19T00:00:00.000Z",
    }),
  ];
  const vm = buildBankerCommandCenterViewModel({
    deals,
    evaluatedAt: "2026-05-20T00:00:00.000Z",
  });
  const item = vm.sections
    .flatMap((s) => s.items)
    .find((i) => i.dealId === "d-fresh");
  assert.equal(item?.staleness, "recently_active");
});

// ---------------------------------------------------------------------------
// 6. Submission-prep queue inclusion
// ---------------------------------------------------------------------------

test("ready_for_submission_prep section surfaces near-clean packages", () => {
  const deals = [
    deal("d-submit", {
      dealId: "d-submit",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
        { id: "y", title: "Balance Sheet", required: true, status: "received" },
      ],
    }),
  ];
  const vm = buildBankerCommandCenterViewModel({ deals });
  const subSection = vm.sections.find(
    (s) => s.id === "ready_for_submission_prep",
  );
  assert.ok(subSection, "submission-prep section missing");
  assert.equal(subSection.items.length, 1);
  assert.equal(subSection.items[0]?.dealId, "d-submit");
});

// ---------------------------------------------------------------------------
// 7. Workload summary counts
// ---------------------------------------------------------------------------

test("workload summary counts derive from queue categories", () => {
  const deals = [
    deal("d-blocked", {
      dealId: "d-blocked",
      blockers: [{ id: "b1", label: "Critical", severity: "critical" }],
    }),
    deal("d-borrower", { dealId: "d-borrower" }),
    deal("d-submit", {
      dealId: "d-submit",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
      ],
    }),
    deal("d-attention", {
      dealId: "d-attention",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "received" },
        { id: "y", title: "Balance Sheet", required: true, status: "needs_attention" },
      ],
    }),
  ];
  const vm = buildBankerCommandCenterViewModel({ deals });
  assert.equal(vm.summary.totalDeals, 4);
  // blocked + submission-ready + attention (needs_clarification) all count as banker action
  assert.ok(vm.summary.bankerActionRequired >= 3);
  assert.equal(vm.summary.borrowerActionRequired, 1);
  assert.equal(vm.summary.readyForSubmissionPrep, 1);
  assert.equal(vm.summary.operationallyBlocked, 1);
  assert.ok(vm.summary.unresolvedAttentionItems >= 1);
});

// ---------------------------------------------------------------------------
// 8. Deterministic ordering
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  const input: BankerCommandCenterInput = {
    deals: [
      deal("d-a", { dealId: "d-a" }),
      deal("d-b", { dealId: "d-b" }),
    ],
  };
  const a = buildBankerCommandCenterViewModel(input);
  const b = buildBankerCommandCenterViewModel(input);
  assert.deepStrictEqual(a, b);
});

test("section ordering is stable and matches spec", () => {
  // Create one deal per category that we can construct via real continuity inputs.
  const deals = [
    deal("d-monitoring", { dealId: "d-monitoring", portalStage: "documents_requested" }),
    deal("d-borrower", { dealId: "d-borrower" }),
    deal("d-attention", {
      dealId: "d-attention",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "received" },
        { id: "y", title: "Balance Sheet", required: true, status: "needs_attention" },
      ],
    }),
    deal("d-submit", {
      dealId: "d-submit",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
      ],
    }),
    deal("d-blocked", {
      dealId: "d-blocked",
      blockers: [{ id: "b", label: "Critical", severity: "critical" }],
    }),
  ];
  const vm = buildBankerCommandCenterViewModel({ deals });
  const presentIds = vm.sections.map((s) => s.id);
  // Each section that appears must follow the spec ORDER
  const indices = presentIds.map((id) =>
    BANKER_COMMAND_CENTER_SECTION_ORDER.indexOf(id),
  );
  const sorted = [...indices].sort((a, b) => a - b);
  assert.deepStrictEqual(indices, sorted);
});

// ---------------------------------------------------------------------------
// 9. Timestamp-safe / no fake SLA
// ---------------------------------------------------------------------------

test("no lastActivityAt is invented when deal omits it", () => {
  const deals = [deal("d-x", { dealId: "d-x" })];
  const vm = buildBankerCommandCenterViewModel({
    deals,
    evaluatedAt: "2026-05-20T00:00:00.000Z",
  });
  const all = vm.sections.flatMap((s) => s.items);
  for (const item of all) {
    assert.equal(item.lastActivityAt, undefined);
    assert.equal(item.staleness, undefined);
    assert.equal(item.daysSinceLastActivity, undefined);
  }
});

// ---------------------------------------------------------------------------
// 10. Recently active list
// ---------------------------------------------------------------------------

test("recently active list omits deals without timestamps and is empty without evaluatedAt", () => {
  const deals = [
    deal("d-fresh", {
      dealId: "d-fresh",
      lastActivityAt: "2026-05-19T00:00:00.000Z",
    }),
    deal("d-old", {
      dealId: "d-old",
      lastActivityAt: "2026-03-01T00:00:00.000Z",
    }),
    deal("d-no-ts", { dealId: "d-no-ts" }),
  ];
  const noEval = buildBankerCommandCenterViewModel({ deals });
  assert.equal(noEval.recentlyActive.length, 0);

  const evaluated = buildBankerCommandCenterViewModel({
    deals,
    evaluatedAt: "2026-05-20T00:00:00.000Z",
    recentlyActiveDaysWindow: 7,
  });
  const ids = evaluated.recentlyActive.map((i) => i.dealId);
  assert.deepStrictEqual(ids, ["d-fresh"]);
});

test("recently active list respects cap", () => {
  const deals = Array.from({ length: 12 }, (_, i) =>
    deal(`d-${String(i).padStart(2, "0")}`, {
      dealId: `d-${String(i).padStart(2, "0")}`,
      lastActivityAt: `2026-05-${String(15 + (i % 5)).padStart(2, "0")}T00:00:00.000Z`,
    }),
  );
  const vm = buildBankerCommandCenterViewModel({
    deals,
    evaluatedAt: "2026-05-20T00:00:00.000Z",
    maxRecentlyActive: 5,
  });
  assert.equal(vm.recentlyActive.length, 5);
});

// ---------------------------------------------------------------------------
// 11. Public label constants
// ---------------------------------------------------------------------------

test("priority/staleness label dictionaries are complete", () => {
  assert.deepStrictEqual(
    Object.keys(BANKER_COMMAND_CENTER_PRIORITY_LABELS).sort(),
    [
      "active_review",
      "immediate_attention",
      "monitoring",
      "progressing",
      "waiting_on_borrower",
    ],
  );
  assert.deepStrictEqual(
    Object.keys(BANKER_COMMAND_CENTER_STALENESS_LABELS).sort(),
    ["needs_review", "recently_active", "stalled", "waiting_for_follow_up"],
  );
});

// ---------------------------------------------------------------------------
// 12. No forbidden terms in VM-derived strings
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  "supabase",
  "classifier",
  "parser error",
  "extraction failed",
  "approval odds",
  "guaranteed",
  "approved",
  "pre-approved",
  "probability of approval",
  "lender acceptance probability",
  "risk score",
  "borrower qualifies",
  "loan will fund",
  "guaranteed funding",
];

function collectText(
  vm: ReturnType<typeof buildBankerCommandCenterViewModel>,
): string {
  const parts: string[] = [];
  for (const section of vm.sections) {
    parts.push(section.label);
    for (const item of section.items) {
      parts.push(
        item.borrowerLabel,
        item.readinessLabel,
        item.waitingOnLabel,
        item.nextBestActionLabel,
        item.topBlocker ?? "",
        item.recentActivitySummary ?? "",
        item.submissionReadinessLabel ?? "",
        item.trustReviewLabel ?? "",
      );
    }
  }
  for (const item of vm.recentlyActive) {
    parts.push(item.borrowerLabel, item.waitingOnLabel);
  }
  return parts.join(" ").toLowerCase();
}

test("no forbidden terms across multiple scenarios", () => {
  const scenarios: BankerCommandCenterInput[] = [
    { deals: [deal("d-x", { dealId: "d-x" })] },
    {
      deals: [
        deal("d-y", {
          dealId: "d-y",
          docs: [
            { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
          ],
        }),
      ],
    },
    {
      deals: [
        deal("d-z", {
          dealId: "d-z",
          blockers: [{ id: "b", label: "Critical", severity: "critical" }],
        }),
      ],
    },
  ];
  for (const input of scenarios) {
    const text = collectText(buildBankerCommandCenterViewModel(input));
    for (const term of FORBIDDEN) {
      assert.ok(!text.includes(term.toLowerCase()), `Forbidden term "${term}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 13. No approval language
// ---------------------------------------------------------------------------

test("no approval/funding/guarantee language across categories", () => {
  const deals = [
    deal("d-submit", {
      dealId: "d-submit",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
      ],
    }),
  ];
  const text = collectText(buildBankerCommandCenterViewModel({ deals }));
  for (const phrase of [
    "you are approved",
    "borrower is approved",
    "loan will fund",
    "guaranteed funding",
    "pre-approved",
    "conditional approval",
    "credit decision",
  ]) {
    assert.ok(!text.includes(phrase), `Approval phrase "${phrase}"`);
  }
});
