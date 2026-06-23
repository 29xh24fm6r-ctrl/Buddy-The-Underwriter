import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerCommunicationViewModel,
  type CommunicationInput,
  type CommunicationActivityEvent,
  type CommunicationBlocker,
  type CommunicationDocItem,
  type CommunicationRecommendation,
} from "@/lib/borrower/buildBorrowerCommunicationViewModel";

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
    activity: [],
    blockers: [],
    documents: [],
    recommendations: [],
    guidanceNextStep: null,
    ...overrides,
  };
}

const docMissing: CommunicationDocItem = {
  id: "d1",
  label: "Business Tax Returns",
  status: "missing",
  required: true,
};
const docAttention: CommunicationDocItem = {
  id: "d2",
  label: "Balance Sheet",
  status: "needs_attention",
  required: true,
};
const docReceived: CommunicationDocItem = {
  id: "d3",
  label: "Personal Financial Statement",
  status: "received",
  required: true,
};

// ---------------------------------------------------------------------------
// 1. Minimal input fallback
// ---------------------------------------------------------------------------

test("minimal input produces a valid no_action_needed view model", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({ portalStage: "getting_started" }),
  );
  assert.equal(vm.state, "no_action_needed");
  assert.ok(vm.headline.length > 0);
  assert.ok(vm.summary.length > 0);
  assert.equal(vm.responseNeededItems.length, 0);
  assert.equal(vm.recentUpdates.length, 1);
  assert.equal(vm.recentUpdates[0]?.type, "no_action_needed");
});

// ---------------------------------------------------------------------------
// 2. action_needed state from blockers
// ---------------------------------------------------------------------------

test("blockers drive action_needed state", () => {
  const blockers: CommunicationBlocker[] = [
    { id: "b1", label: "Missing tax return" },
  ];
  const vm = buildBorrowerCommunicationViewModel(baseInput({ blockers }));
  assert.equal(vm.state, "action_needed");
  assert.equal(vm.actionNeededCount, 1);
  assert.equal(vm.responseNeededItems[0]?.label, "Missing tax return");
  assert.equal(vm.responseNeededItems[0]?.priority, "required");
});

// ---------------------------------------------------------------------------
// 3. blocked state from critical blockers
// ---------------------------------------------------------------------------

test("critical blockers escalate to blocked state", () => {
  const blockers: CommunicationBlocker[] = [
    { id: "b1", label: "Missing 1919 form", severity: "critical" },
  ];
  const vm = buildBorrowerCommunicationViewModel(baseInput({ blockers }));
  assert.equal(vm.state, "blocked");
});

// ---------------------------------------------------------------------------
// 4. no_action_needed state
// ---------------------------------------------------------------------------

test("no blockers and no missing items yields no_action_needed", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      portalStage: "getting_started",
      documents: [docReceived],
    }),
  );
  assert.equal(vm.state, "no_action_needed");
  assert.equal(vm.responseNeededItems.length, 0);
  assert.ok(vm.reassuranceMessage && vm.reassuranceMessage.length > 0);
});

// ---------------------------------------------------------------------------
// 5. waiting_on borrower (missing required docs)
// ---------------------------------------------------------------------------

test("missing required documents = waiting on borrower", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({ documents: [docMissing] }),
  );
  assert.equal(vm.waitingOn, "borrower");
  assert.ok(vm.waitingOnLabel.toLowerCase().includes("borrower"));
});

// ---------------------------------------------------------------------------
// 6. waiting_on Buddy review
// ---------------------------------------------------------------------------

test("buddy_reviewing portal stage with no missing docs = waiting on Buddy review", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      portalStage: "buddy_reviewing",
      documents: [docReceived],
    }),
  );
  assert.equal(vm.waitingOn, "buddy_review");
  assert.ok(vm.waitingOnLabel.toLowerCase().includes("buddy"));
});

// ---------------------------------------------------------------------------
// 7. waiting_on banker review
// ---------------------------------------------------------------------------

test("ready_for_sba_review portal stage = waiting on banker review", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      portalStage: "ready_for_sba_review",
      documents: [docReceived],
    }),
  );
  assert.equal(vm.waitingOn, "banker_review");
  assert.ok(vm.waitingOnLabel.toLowerCase().includes("banker"));
});

// ---------------------------------------------------------------------------
// 8. waiting_on clarification (needs_attention docs)
// ---------------------------------------------------------------------------

test("documents needing attention = waiting on clarification", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({ documents: [docAttention] }),
  );
  assert.equal(vm.waitingOn, "clarification");
  assert.equal(vm.state, "action_needed");
});

// ---------------------------------------------------------------------------
// 9. Response-needed item prioritization
// ---------------------------------------------------------------------------

test("response needed items sort required-first, then helpful", () => {
  const recommendations: CommunicationRecommendation[] = [
    { id: "r1", label: "Add a payroll report", priority: "high" },
  ];
  const blockers: CommunicationBlocker[] = [
    { id: "b1", label: "Missing 1919 form" },
  ];
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({ blockers, recommendations, documents: [docMissing] }),
  );
  const priorities = vm.responseNeededItems.map((i) => i.priority);
  const firstHelpfulIdx = priorities.indexOf("helpful");
  const lastRequiredIdx = priorities.lastIndexOf("required");
  if (firstHelpfulIdx !== -1 && lastRequiredIdx !== -1) {
    assert.ok(firstHelpfulIdx > lastRequiredIdx);
  }
  assert.ok(vm.responseNeededItems.length > 0);
});

// ---------------------------------------------------------------------------
// 10. Recent updates cap
// ---------------------------------------------------------------------------

test("recentUpdates respects default cap of 5", () => {
  const activity: CommunicationActivityEvent[] = Array.from(
    { length: 10 },
    (_, i) => ({
      id: `a${i}`,
      label: `Buddy received doc ${i}`,
      timestamp: `2026-05-${(i + 10).toString().padStart(2, "0")}T12:00:00Z`,
      category: "upload" as const,
    }),
  );
  const vm = buildBorrowerCommunicationViewModel(baseInput({ activity }));
  assert.ok(vm.recentUpdates.length <= 5);
});

test("recentUpdates cap respects override", () => {
  const activity: CommunicationActivityEvent[] = Array.from(
    { length: 6 },
    (_, i) => ({
      id: `a${i}`,
      label: `Buddy received doc ${i}`,
      timestamp: `2026-05-${(i + 10).toString().padStart(2, "0")}T12:00:00Z`,
      category: "upload" as const,
    }),
  );
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({ activity, maxRecentUpdates: 2 }),
  );
  assert.equal(vm.recentUpdates.length, 2);
});

// ---------------------------------------------------------------------------
// 11. Deterministic ordering
// ---------------------------------------------------------------------------

test("same input produces identical output", () => {
  const input = baseInput({
    documents: [docMissing, docAttention, docReceived],
    blockers: [{ id: "b1", label: "Missing 1919 form" }],
    recommendations: [
      { id: "r1", label: "Add a payroll report", priority: "high" },
    ],
    activity: [
      {
        id: "a1",
        label: "Buddy received your document",
        timestamp: "2026-05-15T12:00:00Z",
        category: "upload",
      },
    ],
  });
  const vm1 = buildBorrowerCommunicationViewModel(input);
  const vm2 = buildBorrowerCommunicationViewModel(input);
  assert.deepStrictEqual(vm1, vm2);
});

test("recent updates sort newest-first by timestamp", () => {
  const activity: CommunicationActivityEvent[] = [
    {
      id: "a1",
      label: "Older event",
      timestamp: "2026-05-01T12:00:00Z",
      category: "upload",
    },
    {
      id: "a2",
      label: "Newer event",
      timestamp: "2026-05-20T12:00:00Z",
      category: "upload",
    },
  ];
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      activity,
      documents: [docMissing],
    }),
  );
  const newerIdx = vm.recentUpdates.findIndex((u) => u.label === "Newer event");
  const olderIdx = vm.recentUpdates.findIndex((u) => u.label === "Older event");
  assert.notEqual(newerIdx, -1);
  assert.notEqual(olderIdx, -1);
  assert.ok(newerIdx < olderIdx);
});

// ---------------------------------------------------------------------------
// 12. No fake timestamps
// ---------------------------------------------------------------------------

test("synthesized updates (blocker_added, no_action_needed) omit timestamps", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      blockers: [{ id: "b1", label: "Missing 1919 form" }],
    }),
  );
  const blockerEvent = vm.recentUpdates.find((u) => u.type === "blocker_added");
  assert.ok(blockerEvent);
  assert.equal(blockerEvent.timestamp, undefined);
});

test("activity events preserve provided timestamps verbatim", () => {
  const stamp = "2026-05-15T12:00:00Z";
  const activity: CommunicationActivityEvent[] = [
    {
      id: "a1",
      label: "Buddy received your document",
      timestamp: stamp,
      category: "upload",
    },
  ];
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({ activity, documents: [docMissing] }),
  );
  const event = vm.recentUpdates.find((u) =>
    u.label.toLowerCase().includes("received your"),
  );
  assert.ok(event);
  assert.equal(event.timestamp, stamp);
});

// ---------------------------------------------------------------------------
// 13. Primary CTA logic
// ---------------------------------------------------------------------------

test("primary CTA links to first actionable response item href", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      blockers: [
        { id: "b1", label: "Missing 1919 form", href: "/upload/test-token" },
      ],
    }),
  );
  assert.equal(vm.primaryCtaHref, "/upload/test-token");
  assert.ok(vm.primaryCtaLabel && vm.primaryCtaLabel.length > 0);
});

test("no primary CTA when state is waiting_on_review", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      portalStage: "buddy_reviewing",
      documents: [docReceived],
    }),
  );
  assert.equal(vm.state, "waiting_on_review");
  assert.equal(vm.primaryCtaLabel, undefined);
  assert.equal(vm.primaryCtaHref, undefined);
});

test("no primary CTA when state is no_action_needed", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({ portalStage: "getting_started" }),
  );
  assert.equal(vm.state, "no_action_needed");
  assert.equal(vm.primaryCtaLabel, undefined);
});

// ---------------------------------------------------------------------------
// 14. Response item cap
// ---------------------------------------------------------------------------

test("responseNeededItems caps at default 4", () => {
  const blockers: CommunicationBlocker[] = Array.from({ length: 10 }, (_, i) => ({
    id: `b${i}`,
    label: `Blocker ${i}`,
  }));
  const vm = buildBorrowerCommunicationViewModel(baseInput({ blockers }));
  assert.ok(vm.responseNeededItems.length <= 4);
  assert.equal(vm.actionNeededCount, 10);
});

// ---------------------------------------------------------------------------
// 15. Guidance fallback when no other actions
// ---------------------------------------------------------------------------

test("guidance next step becomes a response item when no blockers or docs", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      portalStage: "documents_requested",
      guidanceNextStep: {
        headline: "Upload your business tax returns",
        description: "This helps Buddy prepare the package.",
        ctaLabel: "Upload",
        href: "/upload/test-token",
      },
    }),
  );
  const fromGuidance = vm.responseNeededItems.find((r) => r.id === "guidance_next_step");
  assert.ok(fromGuidance);
  assert.equal(fromGuidance.priority, "helpful");
});

// ---------------------------------------------------------------------------
// 16. No forbidden borrower-facing terms
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
  "internal review queue",
  "approval odds",
  "guaranteed",
  "approved",
  "probability of approval",
  "risk score",
  "you qualify",
  "you are approved",
  "your loan will be funded",
];

function collectVMText(
  vm: ReturnType<typeof buildBorrowerCommunicationViewModel>,
): string {
  const parts: string[] = [
    vm.headline,
    vm.summary,
    vm.waitingOnLabel,
    vm.reassuranceMessage ?? "",
    vm.primaryCtaLabel ?? "",
  ];
  for (const r of vm.responseNeededItems) {
    parts.push(r.label, r.reason);
  }
  for (const u of vm.recentUpdates) {
    parts.push(u.label, u.description ?? "");
  }
  return parts.join(" ");
}

test("no forbidden terms across all portal stages", () => {
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
      baseInput({
        portalStage: stage,
        blockers: [{ id: "b1", label: "Missing tax return" }],
        documents: [docMissing, docAttention, docReceived],
        recommendations: [{ id: "r1", label: "Add payroll", priority: "high" }],
        activity: [
          {
            id: "a1",
            label: "Buddy received your document",
            timestamp: "2026-05-15T12:00:00Z",
            category: "upload",
          },
        ],
      }),
    );
    const text = collectVMText(vm).toLowerCase();
    for (const term of FORBIDDEN_TERMS) {
      assert.ok(
        !text.includes(term.toLowerCase()),
        `Forbidden term "${term}" in stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 17. No approval / guarantee language under any state
// ---------------------------------------------------------------------------

test("no approval or guarantee language across states", () => {
  const inputs = [
    baseInput({ blockers: [{ id: "b1", label: "Missing 1919" }] }),
    baseInput({ portalStage: "buddy_reviewing", documents: [docReceived] }),
    baseInput({ portalStage: "ready_for_sba_review", documents: [docReceived] }),
    baseInput({ documents: [docAttention] }),
    baseInput({ portalStage: "getting_started" }),
  ];
  const banned = [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "you qualify",
    "you are approved",
    "your loan will",
    "risk score",
    "credit score",
  ];
  for (const input of inputs) {
    const text = collectVMText(buildBorrowerCommunicationViewModel(input)).toLowerCase();
    for (const term of banned) {
      assert.ok(
        !text.includes(term),
        `Banned term "${term}" found in state vm`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 18. Headline includes borrower name when provided
// ---------------------------------------------------------------------------

test("headline uses borrower first name when provided", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      borrowerName: "Jane Doe",
      blockers: [{ id: "b1", label: "Missing 1919" }],
    }),
  );
  assert.ok(vm.headline.startsWith("Jane"));
});

test("headline works without borrower name", () => {
  const vm = buildBorrowerCommunicationViewModel(
    baseInput({
      borrowerName: null,
      blockers: [{ id: "b1", label: "Missing 1919" }],
    }),
  );
  assert.ok(!vm.headline.includes("null"));
  assert.ok(vm.headline.length > 0);
});
