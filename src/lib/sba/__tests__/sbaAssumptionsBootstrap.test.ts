import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const bootstrap = require("../sbaAssumptionsBootstrap") as typeof import("../sbaAssumptionsBootstrap");
const validator = require("../sbaAssumptionsValidator") as typeof import("../sbaAssumptionsValidator");
const buildCandidate = bootstrap.__test_buildCandidate;
const PREVIEW_BIO_PLACEHOLDER = bootstrap.__test_PREVIEW_BIO_PLACEHOLDER;
const { persistAssumptionsDraft } = bootstrap;
const { validateSBAAssumptions } = validator;
type SBAAssumptions = import("../sbaReadinessTypes").SBAAssumptions;

const FULL_PREFILL = {
  revenueStreams: [
    {
      id: "stream_primary",
      name: "Catering Revenue",
      baseAnnualRevenue: 850_000,
      growthRateYear1: 0.1,
      growthRateYear2: 0.08,
      growthRateYear3: 0.06,
      pricingModel: "flat" as const,
      seasonalityProfile: null,
    },
  ],
  costAssumptions: {
    cogsPercentYear1: 0.42,
    cogsPercentYear2: 0.42,
    cogsPercentYear3: 0.42,
    fixedCostCategories: [],
    plannedHires: [],
    plannedCapex: [],
  },
  workingCapital: { targetDSO: 30, targetDPO: 25, inventoryTurns: null },
  loanImpact: {
    loanAmount: 400_000,
    termMonths: 120,
    interestRate: 0.0725,
    existingDebt: [],
    equityInjectionAmount: 50_000,
    equityInjectionSource: "cash_savings" as const,
    sellerFinancingAmount: 0,
    sellerFinancingTermMonths: 0,
    sellerFinancingRate: 0,
    otherSources: [],
  },
  managementTeam: [],
};

test("seeds management team from concierge borrower name when prefill has none", () => {
  const c = buildCandidate({
    dealId: "deal-1",
    prefill: FULL_PREFILL,
    existingRow: null,
    conciergeFacts: {
      borrower: { first_name: "Maria", last_name: "Rivera" },
      loan: { amount_requested: 400_000 },
    },
  });
  assert.equal(c.managementTeam.length, 1);
  assert.equal(c.managementTeam[0].name, "Maria Rivera");
  assert.equal(c.managementTeam[0].title, "Founder / CEO");
  assert.equal(c.managementTeam[0].ownershipPct, 100);
  assert.equal(c.managementTeam[0].bio, PREVIEW_BIO_PLACEHOLDER);
  assert.ok(PREVIEW_BIO_PLACEHOLDER.length >= 20, "placeholder ≥ validator floor");
});

test("does NOT fabricate a name when concierge has no borrower name", () => {
  const c = buildCandidate({
    dealId: "deal-1",
    prefill: FULL_PREFILL,
    existingRow: null,
    conciergeFacts: { loan: { amount_requested: 400_000 } },
  });
  assert.equal(c.managementTeam.length, 0);
});

test("preserves a real bio when one was already filled in", () => {
  const real =
    "Twenty years operating multi-unit restaurants; ServSafe certified; led prior franchise expansion to 4 locations.";
  const prefillWithMember = {
    ...FULL_PREFILL,
    managementTeam: [
      {
        name: "Real Member",
        title: "CEO",
        ownershipPct: 100,
        yearsInIndustry: 20,
        bio: real,
      },
    ],
  };
  const c = buildCandidate({
    dealId: "deal-1",
    prefill: prefillWithMember,
    existingRow: null,
    conciergeFacts: null,
  });
  assert.equal(c.managementTeam[0].bio, real);
});

test("backfills short bios with placeholder for preview", () => {
  const prefillWithMember = {
    ...FULL_PREFILL,
    managementTeam: [
      {
        name: "Pat",
        title: "Owner",
        ownershipPct: 100,
        yearsInIndustry: 5,
        bio: "tbd",
      },
    ],
  };
  const c = buildCandidate({
    dealId: "deal-1",
    prefill: prefillWithMember,
    existingRow: null,
    conciergeFacts: null,
  });
  assert.equal(c.managementTeam[0].bio, PREVIEW_BIO_PLACEHOLDER);
});

test("falls back to concierge loan amount when prefill loanImpact is empty", () => {
  const prefillNoLoan = {
    ...FULL_PREFILL,
    loanImpact: { ...FULL_PREFILL.loanImpact, loanAmount: 0 },
  };
  const c = buildCandidate({
    dealId: "deal-1",
    prefill: prefillNoLoan,
    existingRow: null,
    conciergeFacts: {
      borrower: { first_name: "A", last_name: "B" },
      loan: { amount_requested: 275_000 },
    },
  });
  assert.equal(c.loanImpact.loanAmount, 275_000);
});

test("existing row data wins over prefill (don't trample borrower edits)", () => {
  const prevStreams = [
    {
      id: "edited",
      name: "Edited Stream",
      baseAnnualRevenue: 999_999,
      growthRateYear1: 0.05,
      growthRateYear2: 0.05,
      growthRateYear3: 0.05,
      pricingModel: "flat",
      seasonalityProfile: null,
    },
  ];
  const c = buildCandidate({
    dealId: "deal-1",
    prefill: FULL_PREFILL,
    existingRow: {
      revenue_streams: prevStreams,
      management_team: [
        {
          name: "Existing",
          title: "CEO",
          ownershipPct: 100,
          yearsInIndustry: 10,
          bio: "An existing bio that is comfortably longer than twenty characters.",
        },
      ],
    },
    conciergeFacts: null,
  });
  assert.equal(c.revenueStreams[0].id, "edited");
  assert.equal(c.revenueStreams[0].baseAnnualRevenue, 999_999);
  assert.equal(c.managementTeam[0].name, "Existing");
});

test("happy path produces a candidate that PASSES validateSBAAssumptions", () => {
  const c = buildCandidate({
    dealId: "deal-1",
    prefill: FULL_PREFILL,
    existingRow: null,
    conciergeFacts: {
      borrower: { first_name: "Maria", last_name: "Rivera" },
      loan: { amount_requested: 400_000 },
    },
  });
  const v = validateSBAAssumptions(c);
  assert.equal(v.ok, true, JSON.stringify(v));
});

test("missing revenue stream → validator BLOCKS (no silent bypass)", () => {
  const prefillNoRevenue = { ...FULL_PREFILL, revenueStreams: [] };
  const c = buildCandidate({
    dealId: "deal-1",
    prefill: prefillNoRevenue,
    existingRow: null,
    conciergeFacts: {
      borrower: { first_name: "Maria", last_name: "Rivera" },
      loan: { amount_requested: 400_000 },
    },
  });
  const v = validateSBAAssumptions(c);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.ok(
      v.blockers.some((b) =>
        b.toLowerCase().includes("revenue stream"),
      ),
      JSON.stringify(v.blockers),
    );
  }
});

test("zero loan amount → validator BLOCKS", () => {
  const prefillNoLoan = {
    ...FULL_PREFILL,
    loanImpact: { ...FULL_PREFILL.loanImpact, loanAmount: 0 },
  };
  const c: SBAAssumptions = buildCandidate({
    dealId: "deal-1",
    prefill: prefillNoLoan,
    existingRow: null,
    conciergeFacts: { borrower: { first_name: "A", last_name: "B" } }, // no loan amount
  });
  const v = validateSBAAssumptions(c);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.ok(
      v.blockers.some((b) => b.toLowerCase().includes("loan amount")),
    );
  }
});

// ── persistAssumptionsDraft no-downgrade rule ────────────────────────────
//
// A confirmed row must NEVER be downgraded by a background draft refresh.
// This test focuses on the early-return path so it does not need to mock
// supabaseAdmin (loadSBAAssumptionsPrefill never runs when status is
// already 'confirmed'). The mock SupabaseClient observes that no
// .insert/.update calls were made.

type Mutation =
  | { kind: "select"; table: string }
  | { kind: "insert"; table: string }
  | { kind: "update"; table: string };

function makeMockSb(opts: {
  existing: { id: string; status: string } | null;
}): { sb: unknown; mutations: Mutation[] } {
  const mutations: Mutation[] = [];
  const sb = {
    from(table: string) {
      return {
        select(_cols: string) {
          mutations.push({ kind: "select", table });
          return {
            eq(_col: string, _val: unknown) {
              return {
                async maybeSingle() {
                  return { data: opts.existing, error: null };
                },
              };
            },
          };
        },
        insert(_payload: unknown) {
          mutations.push({ kind: "insert", table });
          return {
            select(_cols: string) {
              return {
                async single() {
                  return { data: { id: "ins-1" }, error: null };
                },
              };
            },
          };
        },
        update(_payload: unknown) {
          mutations.push({ kind: "update", table });
          return {
            async eq(_col: string, _val: unknown) {
              return { data: null, error: null };
            },
          };
        },
      };
    },
  };
  return { sb, mutations };
}

test("persistAssumptionsDraft: confirmed row passes through untouched (no downgrade)", async () => {
  const { sb, mutations } = makeMockSb({
    existing: { id: "existing-1", status: "confirmed" },
  });

  const result = await persistAssumptionsDraft({
    dealId: "deal-1",
    conciergeFacts: { borrower: { first_name: "X", last_name: "Y" } },
    sb: sb as Parameters<typeof persistAssumptionsDraft>[0]["sb"],
  });

  assert.equal(result.assumptionsId, "existing-1");
  assert.equal(result.status, "confirmed");

  // No insert and no update — the early-return guarantees a confirmed row
  // is never rewritten by the proactive draft path.
  assert.equal(
    mutations.some((m) => m.kind === "insert" || m.kind === "update"),
    false,
    JSON.stringify(mutations),
  );
});
