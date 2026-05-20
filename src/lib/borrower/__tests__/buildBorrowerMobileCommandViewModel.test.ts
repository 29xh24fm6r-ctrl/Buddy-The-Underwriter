import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerMobileCommandViewModel,
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
  type DocumentExperienceInput,
  type BorrowerDocumentItemInput,
} from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";

// ---------------------------------------------------------------------------
// Helpers — compose realistic VM stacks
// ---------------------------------------------------------------------------

function journey(overrides: Partial<JourneyInput> = {}) {
  const input: JourneyInput = {
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
    ...overrides,
  };
  return buildBorrowerJourneyViewModel(input);
}

function readiness(overrides: Partial<ReadinessInput> = {}) {
  const input: ReadinessInput = {
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
    ...overrides,
  };
  return buildBorrowerReadinessViewModel(input);
}

function guidance(overrides: Partial<GuidanceInput> = {}) {
  const input: GuidanceInput = {
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
    ...overrides,
  };
  return buildBorrowerGuidanceViewModel(input);
}

function communication(overrides: Partial<CommunicationInput> = {}) {
  const input: CommunicationInput = {
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
    ...overrides,
  };
  return buildBorrowerCommunicationViewModel(input);
}

function documentItems(items: BorrowerDocumentItemInput[]) {
  const input: DocumentExperienceInput = {
    token: "test-token",
    items,
  };
  return buildBorrowerDocumentExperienceViewModel(input);
}

const DEFAULT_DOC_ITEMS: BorrowerDocumentItemInput[] = [
  {
    id: "d1",
    title: "Business Tax Returns",
    required: true,
    status: "missing",
  },
  {
    id: "d2",
    title: "Personal Financial Statement",
    required: true,
    status: "received",
  },
];

function buildInput(overrides: Partial<MobileCommandInput> = {}): MobileCommandInput {
  return {
    borrowerName: "Jane Doe",
    token: "test-token",
    journey: journey(),
    readiness: readiness(),
    guidance: guidance(),
    communication: communication(),
    documents: documentItems(DEFAULT_DOC_ITEMS),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Minimal fallback
// ---------------------------------------------------------------------------

test("minimal input produces a valid no_action_needed view model", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      journey: journey({
        missingItems: [],
        checklistMissing: 0,
        portalStage: "getting_started",
      }),
      readiness: readiness({
        missingItems: [],
        checklistMissing: 0,
        blockerCount: 0,
        portalStage: "getting_started",
      }),
      guidance: guidance({
        missingItems: [],
        checklistMissing: 0,
        blockerCount: 0,
        portalStage: "getting_started",
      }),
      communication: communication({
        blockers: [],
        documents: [],
        portalStage: "getting_started",
      }),
      documents: documentItems([]),
    }),
  );
  assert.equal(vm.state, "no_action_needed");
  assert.ok(vm.headline.length > 0);
  assert.ok(vm.summary.length > 0);
  assert.ok(vm.progressLabel.length > 0);
  assert.equal(vm.priorityItems.length, 0);
  assert.equal(vm.documentPriorityItems.length, 0);
  assert.equal(vm.hasMoreDocumentItems, false);
  assert.equal(vm.primaryCtaLabel, undefined);
});

// ---------------------------------------------------------------------------
// 2. action_needed state from blockers
// ---------------------------------------------------------------------------

test("action_needed state propagates from communication VM", () => {
  const vm = buildBorrowerMobileCommandViewModel(buildInput());
  assert.equal(vm.state, "action_needed");
  assert.ok(vm.headline.toLowerCase().includes("attention"));
  assert.ok(vm.primaryCtaHref);
  assert.ok(vm.primaryCtaLabel);
});

// ---------------------------------------------------------------------------
// 3. blocked state
// ---------------------------------------------------------------------------

test("critical blockers escalate to blocked state on mobile too", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      communication: communication({
        blockers: [
          {
            id: "b1",
            label: "Missing 1919 form",
            severity: "critical",
            href: "/upload/test-token",
          },
        ],
      }),
    }),
  );
  assert.equal(vm.state, "blocked");
  assert.ok(vm.headline.toLowerCase().includes("blocking"));
});

// ---------------------------------------------------------------------------
// 4. waiting state
// ---------------------------------------------------------------------------

test("buddy_reviewing communication VM yields waiting state with no CTA", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      communication: communication({
        blockers: [],
        documents: [
          {
            id: "d1",
            label: "Business Tax Returns",
            status: "received",
            required: true,
          },
        ],
        portalStage: "buddy_reviewing",
      }),
      documents: documentItems([
        {
          id: "d1",
          title: "Business Tax Returns",
          required: true,
          status: "received",
        },
      ]),
    }),
  );
  assert.equal(vm.state, "waiting");
  assert.equal(vm.primaryCtaLabel, undefined);
  assert.equal(vm.primaryCtaHref, undefined);
  assert.ok(vm.waitingOnLabel && vm.waitingOnLabel.length > 0);
});

// ---------------------------------------------------------------------------
// 5. no_action_needed state
// ---------------------------------------------------------------------------

test("no_action_needed state hides CTA and shows reassuring summary", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      communication: communication({
        blockers: [],
        documents: [],
        portalStage: "getting_started",
      }),
      documents: documentItems([]),
    }),
  );
  assert.equal(vm.state, "no_action_needed");
  assert.equal(vm.primaryCtaLabel, undefined);
  assert.ok(vm.summary.toLowerCase().includes("buddy"));
});

// ---------------------------------------------------------------------------
// 6. Primary CTA selection
// ---------------------------------------------------------------------------

test("primary CTA prefers communication VM CTA when available", () => {
  const vm = buildBorrowerMobileCommandViewModel(buildInput());
  assert.equal(vm.primaryCtaHref, "/upload/test-token");
});

test("primary CTA falls back to guidance next step when communication has none", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      communication: communication({
        blockers: [{ id: "b1", label: "Missing item" }],
        documents: [
          { id: "d1", label: "Missing item", status: "missing", required: true },
        ],
      }),
    }),
  );
  // Communication has blocker w/o href → no comm CTA. Guidance has href, so use it.
  assert.ok(vm.primaryCtaHref && vm.primaryCtaHref.includes("/upload/"));
});

// ---------------------------------------------------------------------------
// 7. Document priority item cap
// ---------------------------------------------------------------------------

test("document priority items respect cap of 3", () => {
  const many: BorrowerDocumentItemInput[] = Array.from({ length: 8 }, (_, i) => ({
    id: `m${i}`,
    title: `Business Tax Returns ${i}`,
    required: true,
    status: "missing",
  }));
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({ documents: documentItems(many) }),
  );
  assert.equal(vm.documentPriorityItems.length, 3);
});

test("document priority cap respects override", () => {
  const items: BorrowerDocumentItemInput[] = Array.from({ length: 5 }, (_, i) => ({
    id: `m${i}`,
    title: `Business Tax Returns ${i}`,
    required: true,
    status: "missing",
  }));
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      documents: documentItems(items),
      maxDocumentPriorityItems: 1,
    }),
  );
  assert.equal(vm.documentPriorityItems.length, 1);
});

// ---------------------------------------------------------------------------
// 8. hasMoreDocumentItems
// ---------------------------------------------------------------------------

test("hasMoreDocumentItems is true when more actionable items remain", () => {
  const many: BorrowerDocumentItemInput[] = Array.from({ length: 6 }, (_, i) => ({
    id: `m${i}`,
    title: `Business Tax Returns ${i}`,
    required: true,
    status: "missing",
  }));
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({ documents: documentItems(many) }),
  );
  assert.equal(vm.hasMoreDocumentItems, true);
});

test("hasMoreDocumentItems is false when fewer than cap actionable items", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      documents: documentItems([
        {
          id: "m1",
          title: "Business Tax Returns",
          required: true,
          status: "missing",
        },
      ]),
    }),
  );
  assert.equal(vm.hasMoreDocumentItems, false);
});

// ---------------------------------------------------------------------------
// 9. Priority item ordering
// ---------------------------------------------------------------------------

test("priority items sort required-first then label", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      communication: communication({
        blockers: [
          { id: "z", label: "Zebra Document" },
          { id: "a", label: "Apple Document" },
        ],
        documents: [
          { id: "d1", label: "Apple Document", status: "missing", required: true },
          { id: "d2", label: "Zebra Document", status: "missing", required: true },
        ],
        recommendations: [
          { id: "r1", label: "Add payroll", priority: "high" },
        ],
      }),
    }),
  );
  const labels = vm.priorityItems.map((i) => i.label);
  // Required labels should appear before the helpful recommendation
  const helpfulIdx = vm.priorityItems.findIndex((i) => i.priority === "helpful");
  const lastRequiredIdx = vm.priorityItems
    .map((i, idx) => ({ idx, p: i.priority }))
    .filter((x) => x.p === "required")
    .reduce((max, x) => Math.max(max, x.idx), -1);
  if (helpfulIdx !== -1 && lastRequiredIdx !== -1) {
    assert.ok(helpfulIdx > lastRequiredIdx);
  }
  // Apple before Zebra alphabetically within priority
  const appleIdx = labels.indexOf("Apple Document");
  const zebraIdx = labels.indexOf("Zebra Document");
  assert.ok(appleIdx !== -1 && zebraIdx !== -1);
  assert.ok(appleIdx < zebraIdx);
});

// ---------------------------------------------------------------------------
// 10. Deterministic ordering
// ---------------------------------------------------------------------------

test("same input produces identical output", () => {
  const input = buildInput();
  const vm1 = buildBorrowerMobileCommandViewModel(input);
  const vm2 = buildBorrowerMobileCommandViewModel(input);
  assert.deepStrictEqual(vm1, vm2);
});

// ---------------------------------------------------------------------------
// 11. Readiness label translation
// ---------------------------------------------------------------------------

test("readiness band translates to borrower-safe label", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({
      readiness: readiness({ checklistReceived: 6, checklistMissing: 0 }),
    }),
  );
  assert.ok(vm.readinessLabel && vm.readinessLabel.length > 0);
  assert.ok(
    !vm.readinessLabel.includes("near_submission_ready") &&
      !vm.readinessLabel.includes("strong_progress"),
    "raw band enum leaked into label",
  );
});

test("readinessLabel undefined when readiness VM not provided", () => {
  const vm = buildBorrowerMobileCommandViewModel(
    buildInput({ readiness: undefined }),
  );
  assert.equal(vm.readinessLabel, undefined);
});

// ---------------------------------------------------------------------------
// 12. No forbidden borrower-facing terms
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
  "probability of approval",
  "risk score",
  "you qualify",
  "you are approved",
  "your loan will be funded",
];

function collectVMText(
  vm: ReturnType<typeof buildBorrowerMobileCommandViewModel>,
): string {
  const parts: string[] = [
    vm.headline,
    vm.summary,
    vm.progressLabel,
    vm.readinessLabel ?? "",
    vm.waitingOnLabel ?? "",
    vm.primaryCtaLabel ?? "",
  ];
  for (const item of vm.priorityItems) {
    parts.push(item.label, item.description ?? "");
  }
  for (const item of vm.documentPriorityItems) {
    parts.push(item.label, item.description ?? "");
  }
  return parts.join(" ");
}

test("no forbidden terms across all communication states", () => {
  const stages = ["getting_started", "additional_items_needed", "buddy_reviewing", "ready_for_sba_review"] as const;
  for (const stage of stages) {
    const vm = buildBorrowerMobileCommandViewModel(
      buildInput({
        communication: communication({ portalStage: stage }),
        documents: documentItems(DEFAULT_DOC_ITEMS),
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
// 13. No approval / guarantee language
// ---------------------------------------------------------------------------

test("no approval/guarantee language across states", () => {
  const variants = [
    buildInput(),
    buildInput({
      communication: communication({
        blockers: [],
        documents: [],
        portalStage: "getting_started",
      }),
    }),
    buildInput({
      communication: communication({
        blockers: [],
        documents: [{ id: "d1", label: "X", status: "received", required: true }],
        portalStage: "buddy_reviewing",
      }),
    }),
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
  for (const input of variants) {
    const text = collectVMText(
      buildBorrowerMobileCommandViewModel(input),
    ).toLowerCase();
    for (const term of banned) {
      assert.ok(!text.includes(term), `Forbidden phrase "${term}" found`);
    }
  }
});

// ---------------------------------------------------------------------------
// 14. Progress label always real (no fake percentage)
// ---------------------------------------------------------------------------

test("progress label uses real journey progressPercent", () => {
  const vm = buildBorrowerMobileCommandViewModel(buildInput());
  assert.match(vm.progressLabel, /\d+% complete/);
});
