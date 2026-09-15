import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
let row: any = null;
let saved: any = null;
let race = false;
let started = 0;
let questions: any[] = [];
const input = () => ({
  revenueStreams: [
    {
      id: "one",
      name: "Services",
      baseAnnualRevenue: 500000,
      growthRateYear1: 0.1,
      growthRateYear2: 0.1,
      growthRateYear3: 0.1,
      pricingModel: "flat",
      seasonalityProfile: null,
    },
  ],
  costAssumptions: {
    cogsPercentYear1: 0.4,
    cogsPercentYear2: 0.4,
    cogsPercentYear3: 0.4,
    fixedCostCategories: [],
    plannedHires: [],
    plannedCapex: [],
  },
  workingCapital: { targetDSO: 30, targetDPO: 30, inventoryTurns: null },
  loanImpact: {
    loanAmount: 300000,
    termMonths: 120,
    interestRate: 0.1,
    existingDebt: [],
    equityInjectionAmount: 50000,
    equityInjectionSource: "cash_savings",
    sellerFinancingAmount: 0,
    sellerFinancingTermMonths: 0,
    sellerFinancingRate: 0,
    otherSources: [],
  },
  managementTeam: [
    {
      name: "Test Owner",
      title: "President",
      yearsInIndustry: 10,
      bio: "Ten years managing this fictional test business.",
    },
  ],
});
const sb = {
  from(table: string) {
    assert.equal(table, "buddy_sba_assumptions");
    let values: any;
    const filters: Record<string, unknown> = {};
    return {
      select() {
        return this;
      },
      eq(key: string, value: unknown) {
        filters[key] = value;
        return this;
      },
      update(value: unknown) {
        values = value;
        return this;
      },
      insert(value: unknown) {
        values = value;
        return this;
      },
      async maybeSingle() {
        if (!values) return { data: row, error: null };
        if (row)
          assert.equal(
            filters.updated_at,
            row.updated_at,
            "save must compare the revision at write time",
          );
        if (race) return { data: null, error: null };
        saved = values;
        return {
          data: {
            id: "a",
            updated_at: values.updated_at,
            status: values.status,
          },
          error: null,
        };
      },
    };
  },
};
function stub(module: string, exports: object) {
  const filename = require.resolve(module);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  } as any;
}
stub("@/lib/supabase/admin", { supabaseAdmin: () => sb });
stub("@/lib/sba/sbaAssumptionDrafter", {
  draftAssumptionsFromContext: async () => ({
    assumptions: input(),
    reasoning: "Test draft",
  }),
});
stub("../trident/tridentReadiness", {
  getTridentReadiness: async () => ({ ok: true }),
});
stub("../trident/startTridentGeneration", {
  startTridentGeneration: async () => {
    started++;
    return { ok: true };
  },
});
stub("@/lib/borrower/guidedPackage/service", {
  loadGuidedPackage: async () => ({ questions, readErrors: [] }),
});
const { borrowerPackageAction } =
  require("../borrowerPackageActions") as typeof import("../borrowerPackageActions");
test.beforeEach(() => {
  row = null;
  saved = null;
  race = false;
  started = 0;
  questions = [];
});

test("drafting never silently confirms or persists model estimates", async () => {
  const response = await borrowerPackageAction(
    "draft-assumptions",
    "d",
    "b",
    {},
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "draft");
  assert.equal(saved, null);
});

test("confirmation validates every year's percentages before saving canonical assumptions", async () => {
  const invalid = input();
  invalid.costAssumptions.cogsPercentYear3 = 40;
  const rejected = await borrowerPackageAction("assumptions", "d", "b", {
    revision: null,
    confirmed: true,
    assumptions: invalid,
  });
  assert.equal(rejected.status, 422);
  assert.equal(saved, null);
  const accepted = await borrowerPackageAction("assumptions", "d", "b", {
    revision: null,
    confirmed: true,
    assumptions: input(),
  });
  assert.equal(accepted.status, 200);
  assert.equal((saved as any).status, "confirmed");
  assert.equal((saved as any).deal_id, "d");
  assert.equal((saved as any).loan_impact.interestRate, 0.1);
  assert.ok((saved as any).confirmed_at);
});

test("stale revisions and concurrent edits cannot overwrite another session", async () => {
  row = { updated_at: "2026-09-15T00:00:00Z" };
  const stale = await borrowerPackageAction("assumptions", "d", "b", {
    revision: null,
    assumptions: input(),
  });
  assert.equal(stale.status, 409);
  assert.equal(saved, null);
  race = true;
  const concurrent = await borrowerPackageAction("assumptions", "d", "b", {
    revision: row.updated_at,
    assumptions: input(),
  });
  assert.equal(concurrent.status, 409);
  assert.equal(saved, null);
});

test("saving a draft clears earlier confirmation", async () => {
  row = { updated_at: "2026-09-15T00:00:00Z", status: "confirmed" };
  const response = await borrowerPackageAction("assumptions", "d", "b", {
    revision: row.updated_at,
    assumptions: input(),
  });
  assert.equal(response.status, 200);
  assert.equal((saved as any).status, "draft");
  assert.equal((saved as any).confirmed_at, null);
});

test("required unanswered questions prevent starting the existing factory", async () => {
  questions = [
    {
      responsibility: "borrower",
      required: true,
      state: "unanswered",
      question: "Business address",
    },
  ];
  assert.equal(
    (await borrowerPackageAction("build-package", "d", "b", {})).status,
    409,
  );
  assert.equal(started, 0);
  questions[0].state = "saved";
  assert.equal(
    (await borrowerPackageAction("build-package", "d", "b", {})).status,
    202,
  );
  assert.equal(started, 1);
});
