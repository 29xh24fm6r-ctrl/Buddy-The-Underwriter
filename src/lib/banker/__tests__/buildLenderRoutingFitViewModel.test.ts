import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLenderRoutingFitViewModel,
  LENDER_ROUTING_STATE_LABELS,
  LENDER_ROUTING_OPTION_STATUS_LABELS,
  LENDER_FIT_CRITERION_STATUS_LABELS,
  type LenderRoutingFitInput,
  type DealRoutingProfile,
  type LenderCriteriaRecord,
} from "@/lib/banker/buildLenderRoutingFitViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(over: Partial<LenderRoutingFitInput> = {}): LenderRoutingFitInput {
  return {
    dealId: "deal-1",
    ...over,
  };
}

function fullProfile(over: Partial<DealRoutingProfile> = {}): DealRoutingProfile {
  return {
    loanAmount: 500_000,
    state: "CA",
    industry: "Restaurant",
    naicsCode: "722511",
    useOfProceeds: "acquisition",
    businessStage: "existing",
    franchiseStatus: "non_franchise",
    ownerOccupiedRealEstate: false,
    requiredSbaProgram: "7a",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Minimal fallback
// ---------------------------------------------------------------------------

test("minimal empty input produces gathering_fit_inputs and a safe headline", () => {
  // With an empty deal profile, the generalist channel is always surfaced,
  // and the VM signals that required routing inputs are still being gathered.
  const vm = buildLenderRoutingFitViewModel(makeInput());
  assert.equal(vm.state, "gathering_fit_inputs");
  assert.ok(vm.headline.length > 0);
  assert.ok(vm.options.length > 0);
  assert.ok(vm.missingInputs.length > 0);
});

// ---------------------------------------------------------------------------
// 2. State derivation
// ---------------------------------------------------------------------------

test("gathering_fit_inputs when multiple required inputs missing", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: { loanAmount: 250_000 }, // only loan amount; state/use/industry missing
    }),
  );
  assert.equal(vm.state, "gathering_fit_inputs");
});

test("ready_for_fit_review when inputs sufficient but no usable options", () => {
  // Provide enough required inputs but no lender records and a profile that
  // only matches one channel (generalist) — should still be possible_fit.
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: fullProfile(),
    }),
  );
  // With channel options carrying possible_fit status, state advances to
  // routing_options_available.
  assert.equal(vm.state, "routing_options_available");
});

test("fit_review_in_progress when reviewStartedAt is persisted", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: fullProfile(),
      routingReview: { reviewStartedAt: "2026-05-20T00:00:00.000Z" },
    }),
  );
  assert.equal(vm.state, "fit_review_in_progress");
});

test("routing_review_complete when reviewCompletedAt is persisted", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: fullProfile(),
      routingReview: { reviewCompletedAt: "2026-05-21T00:00:00.000Z" },
    }),
  );
  assert.equal(vm.state, "routing_review_complete");
});

// ---------------------------------------------------------------------------
// 3. Missing input detection
// ---------------------------------------------------------------------------

test("missing inputs detected when deal profile is empty", () => {
  const vm = buildLenderRoutingFitViewModel(makeInput());
  const labels = vm.missingInputs.map((m) => m.label.toLowerCase());
  assert.ok(labels.includes("loan amount"));
  assert.ok(labels.includes("business state"));
  assert.ok(labels.includes("use of proceeds"));
});

test("missing inputs href passes through when caller supplies collectInputsHref", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ collectInputsHref: "/banker/deals/deal-1/profile" }),
  );
  assert.ok(vm.missingInputs.some((m) => m.href === "/banker/deals/deal-1/profile"));
});

test("franchise-status missing is helpful, not required", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile({ franchiseStatus: "unknown" }) }),
  );
  const franchise = vm.missingInputs.find((m) => m.id === "missing_franchise_status");
  assert.ok(franchise);
  assert.equal(franchise.priority, "helpful");
});

// ---------------------------------------------------------------------------
// 4. Channel-level fallback when no lender records
// ---------------------------------------------------------------------------

test("no lender records → channel options only", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile() }),
  );
  assert.ok(vm.options.length > 0);
  for (const option of vm.options) {
    assert.equal(option.type, "channel");
  }
});

test("acquisition use of proceeds surfaces acquisition channel", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile({ useOfProceeds: "acquisition" }) }),
  );
  const ids = vm.options.map((o) => o.id);
  assert.ok(ids.includes("channel_acquisition"));
});

test("franchise borrower surfaces franchise channel", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile({ franchiseStatus: "franchise" }) }),
  );
  const ids = vm.options.map((o) => o.id);
  assert.ok(ids.includes("channel_franchise"));
});

test("non-franchise borrower does NOT surface franchise channel", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile({ franchiseStatus: "non_franchise" }) }),
  );
  const ids = vm.options.map((o) => o.id);
  assert.equal(ids.includes("channel_franchise"), false);
});

// ---------------------------------------------------------------------------
// 5. Specific lender options only when records exist
// ---------------------------------------------------------------------------

test("when lender records exist, options are lender-typed, not channel", () => {
  const lenderCriteria: LenderCriteriaRecord[] = [
    {
      id: "lender-a",
      name: "Coastal SBA Lender",
      type: "lender",
      loanAmountMin: 100_000,
      loanAmountMax: 5_000_000,
      acceptedStates: ["CA", "OR", "WA"],
      acceptedUseOfProceeds: ["acquisition", "expansion"],
      acceptedIndustries: ["Restaurant"],
      acceptsStartups: false,
      acceptsFranchise: true,
      acceptedPrograms: ["7a"],
    },
  ];
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria }),
  );
  assert.ok(vm.options.length === 1);
  assert.equal(vm.options[0]?.type, "lender");
  assert.equal(vm.options[0]?.label, "Coastal SBA Lender");
});

// ---------------------------------------------------------------------------
// 6. Criterion status matrix
// ---------------------------------------------------------------------------

test("loan amount in range yields match status", () => {
  const lenderCriteria: LenderCriteriaRecord[] = [
    {
      id: "lender-a",
      name: "Lender A",
      loanAmountMin: 100_000,
      loanAmountMax: 1_000_000,
      acceptedStates: ["CA"],
      acceptedUseOfProceeds: ["acquisition"],
    },
  ];
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile({ loanAmount: 500_000 }), lenderCriteria }),
  );
  const option = vm.options[0]!;
  const c = option.criteria.find((c) => c.id === "loan_amount_range");
  assert.equal(c?.status, "match");
});

test("loan amount outside range yields mismatch status", () => {
  const lenderCriteria: LenderCriteriaRecord[] = [
    {
      id: "lender-a",
      name: "Lender A",
      loanAmountMin: 100_000,
      loanAmountMax: 200_000,
      acceptedStates: ["CA"],
      acceptedUseOfProceeds: ["acquisition"],
    },
  ];
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile({ loanAmount: 800_000 }), lenderCriteria }),
  );
  const c = vm.options[0]!.criteria.find((c) => c.id === "loan_amount_range");
  assert.equal(c?.status, "mismatch");
});

test("missing deal loan amount yields missing_deal_data on loan range", () => {
  const lenderCriteria: LenderCriteriaRecord[] = [
    {
      id: "lender-a",
      name: "Lender A",
      loanAmountMin: 100_000,
      loanAmountMax: 200_000,
    },
  ];
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: { state: "CA", useOfProceeds: "acquisition", industry: "Restaurant" },
      lenderCriteria,
    }),
  );
  const c = vm.options[0]!.criteria.find((c) => c.id === "loan_amount_range");
  assert.equal(c?.status, "missing_deal_data");
});

test("missing lender amount range yields missing_lender_data on loan range", () => {
  const lenderCriteria: LenderCriteriaRecord[] = [
    { id: "lender-a", name: "Lender A" },
  ];
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria }),
  );
  const c = vm.options[0]!.criteria.find((c) => c.id === "loan_amount_range");
  assert.equal(c?.status, "missing_lender_data");
});

// ---------------------------------------------------------------------------
// 7. Routing option status derivation
// ---------------------------------------------------------------------------

test("option with multiple matches and no missing yields strong_operational_fit", () => {
  const lenderCriteria: LenderCriteriaRecord[] = [
    {
      id: "lender-a",
      name: "Lender A",
      loanAmountMin: 100_000,
      loanAmountMax: 2_000_000,
      acceptedStates: ["CA"],
      acceptedUseOfProceeds: ["acquisition"],
      acceptedIndustries: ["Restaurant"],
      acceptedPrograms: ["7a"],
    },
  ];
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria }),
  );
  assert.equal(vm.options[0]?.status, "strong_operational_fit");
});

test("option with mismatch yields not_currently_compatible", () => {
  const lenderCriteria: LenderCriteriaRecord[] = [
    {
      id: "lender-a",
      name: "Lender A",
      loanAmountMin: 5_000_000,
      loanAmountMax: 25_000_000,
      acceptedStates: ["NY"],
      acceptedUseOfProceeds: ["expansion"],
    },
  ];
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria }),
  );
  assert.equal(vm.options[0]?.status, "not_currently_compatible");
});

// ---------------------------------------------------------------------------
// 8. Next action derivation
// ---------------------------------------------------------------------------

test("next action = collect_routing_inputs when many required inputs missing", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: { loanAmount: 100_000 },
      collectInputsHref: "/banker/deals/deal-1/profile",
    }),
  );
  assert.equal(vm.nextAction.id, "collect_routing_inputs");
  assert.equal(vm.nextAction.href, "/banker/deals/deal-1/profile");
});

test("next action = prepare_lender_outreach when routing_options_available", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: fullProfile(),
      prepareOutreachHref: "/banker/deals/deal-1/outreach",
    }),
  );
  assert.equal(vm.state, "routing_options_available");
  assert.equal(vm.nextAction.id, "prepare_lender_outreach");
  assert.equal(vm.nextAction.href, "/banker/deals/deal-1/outreach");
});

test("next action href omitted when no caller-supplied href", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile() }),
  );
  assert.equal(vm.nextAction.href, undefined);
});

test("next action = no_action_available when routing_review_complete", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: fullProfile(),
      routingReview: { reviewCompletedAt: "2026-05-21T00:00:00.000Z" },
    }),
  );
  assert.equal(vm.nextAction.id, "no_action_available");
});

// ---------------------------------------------------------------------------
// 9. Deterministic ordering
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  const input = makeInput({ dealProfile: fullProfile() });
  const a = buildLenderRoutingFitViewModel(input);
  const b = buildLenderRoutingFitViewModel(input);
  assert.deepStrictEqual(a, b);
});

test("options are stable-sorted by status rank then label", () => {
  const lenderCriteria: LenderCriteriaRecord[] = [
    {
      id: "lender-a",
      name: "Zeta SBA Lender",
      loanAmountMin: 100_000,
      loanAmountMax: 2_000_000,
      acceptedStates: ["CA"],
      acceptedUseOfProceeds: ["acquisition"],
      acceptedIndustries: ["Restaurant"],
    },
    {
      id: "lender-b",
      name: "Alpha SBA Lender",
      loanAmountMin: 100_000,
      loanAmountMax: 2_000_000,
      acceptedStates: ["CA"],
      acceptedUseOfProceeds: ["acquisition"],
      acceptedIndustries: ["Restaurant"],
    },
  ];
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria }),
  );
  // Same status rank → Alpha before Zeta.
  assert.equal(vm.options[0]?.label, "Alpha SBA Lender");
  assert.equal(vm.options[1]?.label, "Zeta SBA Lender");
});

// ---------------------------------------------------------------------------
// 10. No invented lender criteria — channel options don't carry lenderValue
// ---------------------------------------------------------------------------

test("channel-level options do not invent lender values", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile() }),
  );
  for (const option of vm.options) {
    for (const criterion of option.criteria) {
      // Channel options should never claim a lender requirement.
      assert.equal(
        criterion.lenderValue,
        undefined,
        `Channel option ${option.id} criterion ${criterion.id} invented lenderValue`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 11. Public label dictionaries
// ---------------------------------------------------------------------------

test("state, option-status, and criterion-status label dictionaries are complete", () => {
  assert.deepStrictEqual(Object.keys(LENDER_ROUTING_STATE_LABELS).sort(), [
    "fit_review_in_progress",
    "gathering_fit_inputs",
    "not_ready",
    "ready_for_fit_review",
    "routing_options_available",
    "routing_review_complete",
  ]);
  assert.deepStrictEqual(
    Object.keys(LENDER_ROUTING_OPTION_STATUS_LABELS).sort(),
    [
      "needs_more_information",
      "not_currently_compatible",
      "possible_fit",
      "strong_operational_fit",
      "unavailable",
    ],
  );
  assert.deepStrictEqual(
    Object.keys(LENDER_FIT_CRITERION_STATUS_LABELS).sort(),
    [
      "match",
      "mismatch",
      "missing_deal_data",
      "missing_lender_data",
      "not_applicable",
      "possible_match",
    ],
  );
});

// ---------------------------------------------------------------------------
// 12. No forbidden terms across scenarios
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  "approval odds",
  "approved",
  "guaranteed",
  "pre-approved",
  "conditional approval",
  "probability of approval",
  "lender acceptance probability",
  "risk score",
  "best lender",
  "guaranteed funding",
  "loan will fund",
  "borrower qualifies",
  "fake sla",
  "simulated",
  "match score",
  "approval score",
  "highest chance",
  "will accept",
];

function collectText(
  vm: ReturnType<typeof buildLenderRoutingFitViewModel>,
): string {
  const parts: string[] = [
    vm.headline,
    vm.summary,
    vm.routingReadinessLabel,
    vm.nextAction.label,
    vm.nextAction.rationale,
    ...vm.missingInputs.flatMap((m) => [m.label, m.reason]),
    ...vm.options.flatMap((o) => [
      o.label,
      o.summary,
      o.recommendedActionLabel,
      ...o.criteria.flatMap((c) => [c.label, c.explanation, c.dealValue ?? "", c.lenderValue ?? ""]),
      ...o.missingInputs.flatMap((m) => [m.label, m.reason]),
    ]),
  ];
  return parts.join(" ").toLowerCase();
}

test("no forbidden terms across routing scenarios", () => {
  const scenarios: LenderRoutingFitInput[] = [
    makeInput(),
    makeInput({ dealProfile: fullProfile() }),
    makeInput({
      dealProfile: fullProfile(),
      lenderCriteria: [
        {
          id: "lender-a",
          name: "Lender A",
          loanAmountMin: 5_000_000,
          loanAmountMax: 25_000_000,
          acceptedStates: ["NY"],
          acceptedUseOfProceeds: ["expansion"],
        },
      ],
    }),
    makeInput({
      dealProfile: fullProfile(),
      routingReview: { reviewCompletedAt: "2026-05-21T00:00:00.000Z" },
    }),
  ];
  for (const input of scenarios) {
    const text = collectText(buildLenderRoutingFitViewModel(input));
    for (const term of FORBIDDEN) {
      assert.ok(!text.includes(term.toLowerCase()), `Forbidden term "${term}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 13. No approval language
// ---------------------------------------------------------------------------

test("no approval/funding/guarantee phrases in VM output", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: fullProfile(),
      lenderCriteria: [
        {
          id: "lender-a",
          name: "Lender A",
          loanAmountMin: 100_000,
          loanAmountMax: 2_000_000,
          acceptedStates: ["CA"],
          acceptedUseOfProceeds: ["acquisition"],
          acceptedIndustries: ["Restaurant"],
        },
      ],
    }),
  );
  const text = collectText(vm);
  for (const phrase of [
    "you are approved",
    "borrower is approved",
    "loan will fund",
    "guaranteed funding",
    "pre-approved",
    "conditional approval",
    "credit decision",
    "highest chance",
    "will accept",
    "best lender",
  ]) {
    assert.ok(!text.includes(phrase), `Approval phrase "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// 14. No invented timestamps
// ---------------------------------------------------------------------------

test("VM never emits ISO timestamps it didn't receive", () => {
  const vm = buildLenderRoutingFitViewModel(makeInput({ dealProfile: fullProfile() }));
  const json = JSON.stringify(vm);
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(json), false);
});
