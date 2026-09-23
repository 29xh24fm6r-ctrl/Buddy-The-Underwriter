import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { borrowerPackageFailure, packageFailureForCurrentCapacity } from "@/lib/borrower/guidedPackage/completion";

mockServerOnly();
const require = createRequire(import.meta.url);
let row: any = null;
let saved: any = null;
let race = false;
let started = 0;
let questions: any[] = [];
let posterAcknowledged = true;
let bundle: any = null;
let preparation: any = null;
let tridentReadiness: any = { ok: true, preparationReady: true, preparationBlockers: [], reasons: [], warnings: [], evidence: {} };
let readinessCalls = 0;
let capacityAvailable = true;
let capacityCalls = 0;
let evidenceChecks = 0;
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
    assert.ok(
      ["buddy_sba_assumptions", "buddy_trident_bundles"].includes(table),
    );
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
      order() {
        return this;
      },
      limit() {
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
        if (table === "buddy_trident_bundles")
          return { data: bundle, error: null };
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
stub("../trident/packageBudget", { readPackageCapacity: async () => {
  capacityCalls++;
  return { available: capacityAvailable, message: capacityAvailable ? null : "Processing capacity is unavailable." };
} });
stub("../borrowerPackagePreflight", { checkBorrowerPackageEvidence: async () => {
  evidenceChecks++;
  return { status: "passed", checkedAt: new Date().toISOString(), recoveryItems: [], message: "Saved evidence passed." };
} });
stub("@/lib/sba/sbaAssumptionDrafter", {
  draftAssumptionsFromContext: async () => ({
    assumptions: input(),
    reasoning: "Test draft",
  }),
});
stub("../trident/tridentReadiness", {
  getTridentReadiness: async () => {
    readinessCalls++;
    return tridentReadiness;
  },
});
stub("../borrowerPackagePreparation", {
  readBorrowerPackagePreparation: async () => preparation,
  startBorrowerPackagePreparation: async () => {
    started++;
    return { ok: true };
  },
});
stub("@/lib/borrower/guidedPackage/service", {
  loadGuidedPackage: async () => ({ questions, readErrors: [], form722: { posterAvailable: true, acknowledged: posterAcknowledged } }),
});
const { borrowerPackageAction } =
  require("../borrowerPackageActions") as typeof import("../borrowerPackageActions");
test.beforeEach(() => {
  posterAcknowledged = true;
  row = null;
  saved = null;
  race = false;
  started = 0;
  questions = [];
  bundle = null;
  preparation = null;
  tridentReadiness = { ok: true, preparationReady: true, preparationBlockers: [], reasons: [], warnings: [], evidence: {} };
  readinessCalls = 0;
  capacityAvailable = true; capacityCalls = 0; evidenceChecks = 0;
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

test("package status exposes authoritative blockers and individual artifacts", async () => {
  questions = [
    {
      responsibility: "borrower",
      required: true,
      state: "unanswered",
      question: "Business address",
    },
  ];
  tridentReadiness = {
    ok: false,
    preparationReady: false,
    preparationBlockers: ["Upload at least two financial documents."],
    reasons: ["Upload at least two financial documents."],
    warnings: ["An estimate still needs review."],
    evidence: { documentCount: 1 },
  };
  bundle = {
    status: "failed",
    business_plan_pdf_path: "business-plan.pdf",
  };
  const response = await borrowerPackageAction("package-status", "d", "b");
  const payload = await response.json();
  assert.equal(payload.readiness.readyToGenerate, false);
  assert.deepEqual(payload.readiness.blockers, [
    "Business address",
    "Upload at least two financial documents.",
  ]);
  assert.equal(payload.readiness.packageFiles.length, 6);
  assert.equal(payload.readiness.packageFiles[0].ready, true);
  assert.equal(payload.readiness.packageFiles[1].ready, false);
});

test("active generation status does not rerun expensive readiness checks", async () => {
  bundle = { status: "running", current_stage: "projections" };
  tridentReadiness = null;
  const response = await borrowerPackageAction("package-status", "d", "b");
  const payload = await response.json();
  assert.equal(payload.bundle.status, "running");
  assert.equal(payload.readiness.readyToGenerate, false);
  assert.deepEqual(payload.readiness.blockers, []);
  assert.equal(readinessCalls, 0);
  assert.equal(capacityCalls, 0);
});

test("capacity blocks status and POST admission before creating a preparation job", async () => {
  capacityAvailable = false;
  const status = await (await borrowerPackageAction("package-status", "d", "b")).json();
  assert.equal(status.readiness.readyToPrepare, false);
  assert.equal(status.readiness.capacity.available, false);
  const response = await borrowerPackageAction("build-package", "d", "b", {});
  assert.equal(response.status, 503); assert.equal(started, 0);
  capacityAvailable = true;
  assert.equal((await borrowerPackageAction("build-package", "d", "b", {})).status, 202);
});
for (const source of ["preparation", "bundle"]) test(`${source} capacity failure follows current availability without changing the saved attempt`, async () => {
  if (source === "preparation") preparation = { id: "p", status: "failed", stage: "checking", message: borrowerPackageFailure("budget_unavailable"), bundleId: null };
  else bundle = { id: "b", status: "failed", generation_error: "budget_unavailable: private accounting details" };
  const before = structuredClone({ preparation, bundle });
  for (const available of [false, true, false]) {
    capacityAvailable = available;
    const result = await (await borrowerPackageAction("package-status", "d", "b")).json();
    const attempt = source === "preparation" ? result.preparation : result.bundle;
    const message = source === "preparation" ? attempt.message : attempt.generation_error;
    assert.equal(attempt.status, "failed", "recovery does not turn an unsuccessful attempt into success");
    assert.match(message, /previous preparation attempt stopped/);
    assert.doesNotMatch(message, /private accounting|is paused|wait for capacity to reset/i);
    assert.equal(message.includes("Capacity is available now"), available);
    assert.equal(result.readiness.readyToPrepare, available);
    assert.equal(result.readiness.capacity.available, available);
    assert.equal(result.readiness.packageFiles.every((file: any) => !file.ready), true);
    assert.deepEqual({ preparation, bundle }, before);
    assert.equal(started, 0);
    assert.equal(saved, null);
  }
});
test("capacity recovery preserves other blockers and does not admit preparation", async () => {
  preparation = { id: "p", status: "failed", stage: "checking", message: borrowerPackageFailure("budget_unavailable"), bundleId: null };
  tridentReadiness.preparationReady = false;
  tridentReadiness.preparationBlockers = ["Upload accepted financial documents."];
  const result = await (await borrowerPackageAction("package-status", "d", "b")).json();
  assert.match(result.preparation.message, /Capacity is available now/);
  assert.equal(result.readiness.readyToPrepare, false);
  assert.deepEqual(result.readiness.blockers, tridentReadiness.preparationBlockers);
  assert.equal((await borrowerPackageAction("build-package", "d", "b", {})).status, 409);
  assert.equal(started, 0);
});
test("unverified capacity never claims recovery, and unrelated failures remain actionable", () => {
  const message = borrowerPackageFailure("budget_unavailable");
  assert.doesNotMatch(packageFailureForCurrentCapacity(message, null)!, /available now|is paused/);
  const otherFailure = "Business research could not be completed. Review your business details and retry preparation.";
  assert.equal(packageFailureForCurrentCapacity(otherFailure, { available: true, message: null }), otherFailure);
  assert.equal(packageFailureForCurrentCapacity(null, { available: true, message: null }), null);
});
test("the explicit evidence check works while capacity is unavailable and never starts preparation", async () => {
  capacityAvailable = false;
  const result = await (await borrowerPackageAction("check-package", "d", "b", {})).json();
  assert.equal(result.check.status, "passed"); assert.equal(evidenceChecks, 1);
  assert.equal(started, 0); assert.equal(capacityCalls, 0);
});
test("missing validation or research is unchecked, not a false evidence pass", async () => {
  tridentReadiness.ok = false;
  const result = await (await borrowerPackageAction("check-package", "d", "b", {})).json();
  assert.equal(result.check.status, "not_checked"); assert.equal(evidenceChecks, 0); assert.equal(started, 0);
});

test("poster acknowledgment blocks both status and POST before any workflow starts", async () => {
  posterAcknowledged = false;
  const status = await (await borrowerPackageAction("package-status", "d", "b")).json();
  assert.equal(status.readiness.readyToPrepare, false);
  assert.equal(status.readiness.completionItems[0].id, "form722");
  const before = started;
  assert.equal((await borrowerPackageAction("build-package", "d", "b", {})).status, 409);
  assert.equal(started, before);
});
test("failed form generation returns safe actionable instructions without raw identifiers", async () => {
  bundle = {status: "failed", generation_error: "SBA_1919 position private-owner-id; SBA_722 not_acknowledged"};
  const status = await (await borrowerPackageAction("package-status", "d", "b")).json();
  assert.match(status.bundle.generation_error, /title or role/);
  assert.doesNotMatch(status.bundle.generation_error, /private-owner-id/);
});

test("final quality failure returns specific safe recovery without releasing underwriting artifacts", async () => {
  bundle={id:"failed-bundle",status:"failed",generation_error:"private-error sources_and_uses_not_reconciled feasibility_data_completeness_below_70_percent market_demand.populationAdequacy",business_plan_pdf_path:"private/storage/path"};
  const response=await borrowerPackageAction("package-status","deal","bank");
  const result=await response.json();
  assert.ok(result.recoveryItems.some((item:any)=>item.questionId==="loan.use_of_proceeds"));
  assert.ok(result.recoveryItems.some((item:any)=>item.id==="feasibility"));
  assert.doesNotMatch(JSON.stringify(result),/private-error|private\/storage\/path/);
});
