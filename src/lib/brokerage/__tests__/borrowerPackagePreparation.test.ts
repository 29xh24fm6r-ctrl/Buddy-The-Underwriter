import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { LENDER_PACKAGE_FILES } from "../lenderPackageFiles";

mockServerOnly();
const require = createRequire(import.meta.url);
function stub(module: string, exports: object) {
  const filename = require.resolve(module);
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as any;
}
let tables: Record<string, any[]>;
let queued: { workflow: (...args: any[]) => Promise<any>; args: any[] }[];
let events: string[];
let startFails: boolean;
let trackingFails: boolean;
let researchFails: boolean;
let researchNeverCompletes: boolean;
let subject: { company_name: string };
let duringResearch: (() => void) | undefined;
let answersComplete: boolean;
let sequence: number;
let budgetBlocked = false;

// Stateful storage double, not a mocked readiness verdict. The SQL contract
// (atomic admission, tenant isolation and budget writes) is separately tested
// against Postgres in borrowerPackagePreparationSql.test.ts.
const sb = {
  from(table: string) {
    assert.ok(table in tables, `Unexpected table ${table}`);
    const filters: Array<(row: any) => boolean> = [];
    let values: any, inserted: any, count = false, single = false, limit = Infinity;
    const order: Array<[string, boolean]> = [];
    const q: any = {
      select(_columns?: string, options?: any) { count = options?.count === "exact"; return q; },
      eq(key: string, value: any) { filters.push(row => row[key] === value); return q; },
      gt(key: string, value: any) { filters.push(row => row[key] > value); return q; },
      order(key: string, opts: any) { order.push([key, opts.ascending]); return q; },
      limit(n: number) { limit = n; return q; },
      update(v: any) { values = v; return q; },
      insert(v: any) { inserted = v; return q; },
      result() {
        if (values?.workflow_run_id && trackingFails) return { data: null, error: { message: "tracking unavailable" } };
        if (inserted) { tables[table].push({ id: `row-${++sequence}`, ...inserted }); inserted = null; }
        let rows = tables[table].filter(row => filters.every(match => match(row)));
        if (values) rows.forEach(row => Object.assign(row, values));
        for (const [key, ascending] of [...order].reverse()) rows = rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1));
        rows = rows.slice(0, limit);
        return { data: count ? null : single ? rows[0] ?? null : rows, count: count ? rows.length : null, error: null };
      },
      single() { single = true; return Promise.resolve(q.result()); },
      maybeSingle() { single = true; return Promise.resolve(q.result()); },
      then(resolve: any, reject: any) { return Promise.resolve(q.result()).then(resolve, reject); },
    };
    return q;
  },
  async rpc(name: string, args: any) {
    assert.equal(args.p_deal_id, "deal"); assert.equal(args.p_bank_id, "bank");
    if (name === "acquire_borrower_package_preparation") {
      const active = tables.borrower_package_preparations.find(row => row.status === "running");
      if (active) return { data: { id: active.id, reused: true }, error: null };
      const row = { id: `prep-${++sequence}`, deal_id: "deal", bank_id: "bank", status: "running", stage: "checking", created_at: new Date(Date.now() + sequence).toISOString(), expires_at: new Date(Date.now() + 2700000).toISOString() };
      tables.borrower_package_preparations.push(row);
      return { data: { id: row.id, reused: false }, error: null };
    }
    assert.equal(name, "sync_borrower_package_proceeds");
    tables.deal_proceeds_items = tables.deal_loan_requests[0].use_of_proceeds.map((row: any) => ({deal_id: "deal", ...row}));
    events.push("budget");
    return { data: null, error: null };
  },
};
stub("@/lib/supabase/admin", { supabaseAdmin: () => sb });
stub("@/lib/modelEngine/engineAuthority", { computeAuthoritativeEngine: async () => {
  const facts = tables.deal_financial_facts;
  const financialModel = require("@/lib/modelEngine/buildFinancialModel").buildFinancialModel("deal", facts);
  return { financialModel, facts, viewModel: {}, computedMetrics: {}, riskFlags: [] };
} });
stub("@/lib/classicSpread/classicSpreadLoader", { loadClassicSpreadData: async () => ({ periods: [], incomeStatement: [], balanceSheet: [] }) });

stub("../trident/packageBudget", { assertPackageBudgetAvailable: async () => {
  if (budgetBlocked) throw new Error("budget_unavailable: verifier QA allocation");
} });
stub("workflow/api", { start: async (workflow: any, args: any[]) => {
  if (startFails) throw new Error("queue unavailable");
  queued.push({ workflow, args }); return { runId: "durable-run" };
} });
stub("workflow", { FatalError: class FatalError extends Error {}, sleep: async () => {
  duringResearch?.();
  if (researchNeverCompletes) return;
  tables.buddy_research_missions[0].status = researchFails ? "failed" : "complete";
  tables.buddy_research_missions[0].completed_at = new Date().toISOString();
  tables.buddy_research_quality_gates = [{ mission_id: "mission", trust_grade: "preliminary" }];
} });
stub("@/lib/borrower/guidedPackage/service", { loadGuidedPackage: async () => ({
  questions: [{ responsibility: "borrower", required: true, state: answersComplete ? "saved" : "missing", question: "Business address" }], readErrors: [], form722: { posterAvailable: true, acknowledged: true },
}) });
stub("@/lib/sba/sbaAssumptionDrafter", { draftAssumptionsFromContext: async () => { throw new Error("Unexpected model call"); } });
stub("@/lib/research/buildResearchSubject", { buildResearchEntityProfile: async () => ({ represented: true, subject }) });
stub("@/lib/research/startResearchMission", { startResearchMission: async () => {
  events.push("research");
  tables.buddy_research_missions = [{ id: "mission", deal_id: "deal", bank_id: "bank", status: "running" }];
  return { ok: true, accepted: true, mission_id: "mission" };
} });
stub("../trident/startTridentGeneration", { startTridentGeneration: async () => {
  const readiness = await require("../trident/tridentReadiness").getTridentReadiness({ sb, dealId: "deal", bankId: "bank" });
  assert.equal(readiness.ok, true, readiness.reasons.join("\n"));
  assert.ok(tables.buddy_validation_reports.length, "real validator must persist before final admission");
  events.push("generation");
  tables.buddy_trident_bundles = [{ id: "bundle", deal_id: "deal", bank_id: "bank", mode: "final", status: "succeeded", ...Object.fromEntries(LENDER_PACKAGE_FILES.map(file => [file.column, `test/${file.filename}`])) }];
  return { ok: true, accepted: true, bundleId: "bundle" };
} });
const { borrowerPackageAction } = require("../borrowerPackageActions") as typeof import("../borrowerPackageActions");
const { generateBorrowerPackage } = require("../borrowerPackagePreparation") as typeof import("../borrowerPackagePreparation");
const { runBuddyValidationPass } = require("@/lib/validation/buddyValidationPass") as typeof import("@/lib/validation/buddyValidationPass");

test.beforeEach(() => {
  budgetBlocked = false;
  sequence = 0; queued = []; events = []; startFails = trackingFails = researchFails = researchNeverCompletes = false;
  subject = { company_name: "Synthetic integration fixture" }; duringResearch = undefined; answersComplete = true;
  const facts = { TOTAL_REVENUE: 500000, NET_INCOME: 80000, ANNUAL_DEBT_SERVICE: 40000, DSCR: 2, CASH_FLOW_AVAILABLE: 80000, TOTAL_ASSETS: 300000, TOTAL_LIABILITIES: 200000, NET_WORTH: 100000 };
  tables = {
    deals: [{ id: "deal", bank_id: "bank", is_test: false, entity_type: "operating_company" }],
    buddy_sba_assumptions: [{ deal_id: "deal", status: "confirmed", confirmed_at: new Date().toISOString(), revenue_streams: [{}], management_team: [{}], cost_assumptions: {}, working_capital: {}, loan_impact: {} }],
    deal_documents: [1, 2].map(id => ({ id, deal_id: "deal", bank_id: "bank" })),
    deal_financial_facts: Object.entries(facts).map(([fact_key, fact_value_num]) => ({ deal_id: "deal", bank_id: "bank", is_superseded: false, fact_key, fact_value_num })),
    deal_loan_requests: [{ deal_id: "deal", bank_id: "bank", use_of_proceeds: [{ category: "equipment", amount: 300000 }] }],
    borrower_concierge_sessions: [{ deal_id: "deal", confirmed_facts: {} }],
    deal_proceeds_items: [], buddy_trident_bundles: [], buddy_validation_reports: [],
    buddy_research_missions: [], buddy_research_quality_gates: [], borrower_package_preparations: [],
  };
});
async function status() { return (await borrowerPackageAction("package-status", "deal", "bank")).json(); }
async function start() {
  const response = await borrowerPackageAction("build-package", "deal", "bank", {});
  assert.equal(response.status, 202); return response.json();
}
async function run() { return queued[0].workflow(...queued[0].args); }

test("borrower with complete inputs and no staff outputs reaches final admission through the real readiness and validation gates", async () => {
  const before = await status();
  assert.equal(before.readiness.readyToGenerate, false);
  assert.equal(before.readiness.readyToPrepare, true);
  assert.equal(events.length, 0, "status reads must not perform paid work");
  const a = await start(); const b = await start();
  assert.equal(a.preparationId, b.preparationId); assert.equal(queued.length, 1);
  assert.equal((await status()).preparation.status, "running");
  await run();
  const after = await status();
  assert.equal(after.preparation.status, "succeeded"); assert.equal(after.preparation.bundleId, "bundle");
  assert.equal(after.bundle.status, "succeeded"); assert.equal(after.readiness.packageFiles.filter((file: any) => file.ready).length, 6);
  assert.deepEqual(events, ["budget", "research", "budget", "generation"]);
  // A lost response after final handoff does not repeat generation.
  assert.equal(await generateBorrowerPackage(queued[0].args[0]), "bundle");
  assert.equal(events.filter(event => event === "generation").length, 1);
});

test("genuine financial inconsistencies stop before research and explain the correction", async () => {
  tables.deal_financial_facts.find(row => row.fact_key === "TOTAL_ASSETS").fact_value_num = 900000;
  await start(); await assert.rejects(run(), /financial information needs attention/);
  const state = await status();
  assert.equal(state.preparation.status, "failed"); assert.match(state.preparation.message, /imbalance/);
  assert.deepEqual(events, ["budget"]); assert.equal(state.bundle, null);
});

test("missing borrower answers still block preparation without queueing work", async () => {
  answersComplete = false;
  assert.equal((await borrowerPackageAction("build-package", "deal", "bank", {})).status, 409);
  assert.equal(queued.length, 0);
});

test("start failure releases only its own admission and a retry can start", async () => {
  startFails = true;
  assert.equal((await borrowerPackageAction("build-package", "deal", "bank", {})).status, 503);
  assert.equal((await status()).preparation.status, "failed");
  startFails = false; await start(); assert.equal(queued.length, 1);
});

test("tracking failure after durable start preserves ownership against repeat clicks", async () => {
  trackingFails = true;
  const first = await start(); const repeated = await start();
  assert.equal(first.preparationId, repeated.preparationId); assert.equal(queued.length, 1);
  await run(); assert.equal((await status()).preparation.status, "succeeded");
});

test("failed and timed-out research never admits final artifacts", async () => {
  researchFails = true; await start(); await assert.rejects(run(), /research could not be completed/);
  assert.equal(events.includes("generation"), false);
  researchFails = false; researchNeverCompletes = true;
  await start(); await queued[1].workflow(...queued[1].args);
  assert.match((await status()).preparation.message, /longer than expected/);
  assert.equal(events.includes("generation"), false);
});

test("edits during research require renewed confirmation and cannot enter the frozen package", async () => {
  duringResearch = () => { tables.buddy_sba_assumptions[0].status = "draft"; };
  await start(); await assert.rejects(run(), /must be confirmed/);
  assert.equal(events.includes("generation"), false);
});

test("research for an earlier business identity cannot satisfy the updated application", async () => {
  duringResearch = () => { subject = { company_name: "Changed business" }; };
  await start(); await assert.rejects(run(), /business details changed/);
  assert.equal(events.includes("generation"), false);
});

test("synthetic QA keeps its explicit research exemption but still runs real validation", async () => {
  tables.deals[0].is_test = true;
  await start(); await run();
  assert.deepEqual(events, ["budget", "budget", "generation"]);
  assert.ok(tables.buddy_validation_reports.length);
});

test("returning to a previously valid fact snapshot replaces a newer unrelated FAIL", async () => {
  const first = await runBuddyValidationPass("deal"); assert.equal(first.overallStatus, "PASS");
  tables.buddy_validation_reports[0].run_at = "2020-01-01T00:00:00Z";
  tables.buddy_validation_reports.push({ deal_id: "deal", overall_status: "FAIL", snapshot_hash: "different", run_at: "2021-01-01T00:00:00Z" });
  await runBuddyValidationPass("deal");
  assert.equal(tables.buddy_validation_reports.length, 3);
  const state = await status(); assert.equal(state.readiness.evidence.validationStatus, "PASS");
});

test("a pre-opening borrower reaches final admission from documents and assumptions without historical income or staff facts", async () => {
  tables.deals[0].is_test=true;
  tables.borrower_concierge_sessions[0].confirmed_facts={package_answers:{B07:{value:"The business is preparing to open"},K02:{value:"New franchise location"}}};
  tables.deal_financial_facts=Object.entries({ CASH_AND_EQUIVALENTS:250000, TOTAL_ASSETS:250000, TOTAL_LIABILITIES:0, TOTAL_EQUITY:250000, COMMON_STOCK:250000 }).map(([fact_key,fact_value_num])=>({
    deal_id:"deal",bank_id:"bank",is_superseded:false,fact_type:"BALANCE_SHEET",fact_key,fact_value_num,fact_period_end:"2026-09-21",resolution_status:"inferred",owner_type:"DEAL",confidence:1,
  }));
  Object.assign(tables.buddy_sba_assumptions[0], {
    revenue_streams:[{id:"r1",name:"Coffee",pricingModel:"flat",baseAnnualRevenue:1500000,growthRateYear1:0,growthRateYear2:.05,growthRateYear3:.05}],
    cost_assumptions:{cogsPercentYear1:.3,cogsPercentYear2:.3,cogsPercentYear3:.3,fixedCostCategories:[{id:"o1",name:"Operating costs",annualAmount:650000,escalationPctPerYear:.03}],plannedHires:[],plannedCapex:[]},
    working_capital:{targetDSO:1,targetDPO:15,inventoryTurns:24},
    loan_impact:{loanAmount:950000,termMonths:120,interestRate:.1,existingDebt:[],equityInjectionAmount:250000,equityInjectionSource:"cash_savings",sellerFinancingAmount:0,sellerFinancingTermMonths:0,sellerFinancingRate:0,otherSources:[]},
    management_team:[{name:"QA Owner",title:"Manager",yearsInIndustry:10,bio:"Synthetic test owner with ten years of beverage management experience."}],
  });
  tables.buddy_guarantor_cashflow=[]; tables.deal_ownership_entities=[]; tables.deal_ownership_interests=[];
  tables.deal_loan_requests[0].use_of_proceeds = [{category:"equipment",amount:1200000}];
  const originalFacts=JSON.stringify(tables.deal_financial_facts);
  await start(); await run();
  assert.equal((await status()).preparation.status,"succeeded");
  assert.deepEqual(events,["budget","budget","generation"]);
  assert.equal(tables.buddy_validation_reports.at(-1).overall_status,"PASS_WITH_FLAGS");
  assert.equal(JSON.stringify(tables.deal_financial_facts),originalFacts);
});

test("unreconciled borrower budget blocks paid work, then a saved correction resumes preparation", async () => {
  tables.buddy_sba_assumptions[0].loan_impact={loanAmount:300000,equityInjectionAmount:50000,sellerFinancingAmount:0,otherSources:[]};
  const blockedStatus=await status();
  assert.equal(blockedStatus.readiness.readyToPrepare,false);
  assert.equal(blockedStatus.readiness.budget.difference,50000);
  assert.ok(blockedStatus.readiness.completionItems.some((item:any)=>item.questionId==="loan.use_of_proceeds"));
  const response=await borrowerPackageAction("build-package","deal","bank");
  assert.equal(response.status,409);
  assert.equal(queued.length,0); assert.deepEqual(events,[]);
  tables.deal_loan_requests[0].use_of_proceeds.push({category:"working_capital",amount:50000});
  assert.equal((await status()).readiness.readyToPrepare,true);
  await start(); await run();
  assert.equal((await status()).preparation.status,"succeeded");
});

test("unavailable package capacity stops before research and presents wait guidance", async () => {
  budgetBlocked = true;
  await start();
  await assert.rejects(run(), /capacity/);
  assert.deepEqual(events, []);
  const row = tables.borrower_package_preparations[0];
  assert.equal(row.status, "failed");
  assert.match(row.message, /retrying immediately will not help/);
});
