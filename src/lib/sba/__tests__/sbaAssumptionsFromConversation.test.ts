import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const conv = require("../sbaAssumptionsFromConversation") as typeof import("../sbaAssumptionsFromConversation");
const validator = require("../sbaAssumptionsValidator") as typeof import("../sbaAssumptionsValidator");
const { extractAssumptionsFromConversation, shapeRawExtraction } = conv;
const { validateSBAAssumptions } = validator;

// ── shapeRawExtraction: pure mapping tests (no Gemini in the loop) ──

test("shape: filters revenue streams with name + positive baseAnnualRevenue", () => {
  const r = shapeRawExtraction({
    revenueStreams: [
      { name: "Auto Sales", baseAnnualRevenue: 3_150_000, evidence: "70-80 cars/mo at $3500/unit" },
      { name: "Service Department", baseAnnualRevenue: 2_160_000, evidence: "18 bays at $10,000/bay/mo" },
      { name: "Tire Shop", baseAnnualRevenue: 240_000, evidence: "4 bays at $5,000/bay/mo" },
      { name: "", baseAnnualRevenue: 100, evidence: "should be dropped" },
      { name: "Bad Number", baseAnnualRevenue: 0, evidence: "zero dropped" },
      { name: "NaN", baseAnnualRevenue: Number.NaN, evidence: "NaN dropped" },
    ],
  });
  assert.equal(r.partial.revenueStreams?.length, 3);
  assert.deepEqual(
    r.partial.revenueStreams?.map((s) => s.name),
    ["Auto Sales", "Service Department", "Tire Shop"],
  );
  assert.equal(r.partial.revenueStreams?.[0].baseAnnualRevenue, 3_150_000);
  assert.equal(r.evidence["revenueStreams[0]"], "70-80 cars/mo at $3500/unit");
  assert.equal(
    r.evidence["revenueStreams[2]"],
    "4 bays at $5,000/bay/mo",
  );
});

test("shape: revenue streams get unique non-empty IDs", () => {
  const r = shapeRawExtraction({
    revenueStreams: [
      { name: "Auto Sales", baseAnnualRevenue: 3_150_000 },
      { name: "Service Department", baseAnnualRevenue: 2_160_000 },
      { name: "Auto Sales", baseAnnualRevenue: 1, evidence: "intentionally tiny" }, // dropped
    ],
  });
  const ids = r.partial.revenueStreams?.map((s) => s.id) ?? [];
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  assert.ok(ids.every((id) => id.length > 0));
});

test("shape: cogsPercentYear1 fans out to Y2/Y3", () => {
  const r = shapeRawExtraction({
    costAssumptions: { cogsPercentYear1: 0.42 },
  });
  assert.equal(r.partial.costAssumptions?.cogsPercentYear1, 0.42);
  assert.equal(r.partial.costAssumptions?.cogsPercentYear2, 0.42);
  assert.equal(r.partial.costAssumptions?.cogsPercentYear3, 0.42);
});

test("shape: rejects nonsense cogs values", () => {
  for (const v of [0, -0.5, 1.2, Number.NaN, Infinity]) {
    const r = shapeRawExtraction({ costAssumptions: { cogsPercentYear1: v } });
    assert.equal(
      r.partial.costAssumptions?.cogsPercentYear1 ?? 0,
      0,
      `cogs ${v} must be rejected`,
    );
  }
});

test("shape: planned hires expand by headcount", () => {
  const r = shapeRawExtraction({
    costAssumptions: {
      plannedHires: [
        {
          role: "Service Technician",
          annualSalary: 65_000,
          headcount: 18,
          evidence: "18-person service team",
        },
        {
          role: "Salesperson",
          annualSalary: 55_000,
          headcount: 9,
          evidence: "8-10 salespeople",
        },
      ],
    },
  });
  const hires = r.partial.costAssumptions?.plannedHires ?? [];
  assert.equal(hires.length, 18 + 9);
  assert.equal(
    hires.filter((h) => h.role === "Service Technician").length,
    18,
  );
  assert.equal(hires.filter((h) => h.role === "Salesperson").length, 9);
});

test("shape: fixed cost categories drop unnamed / zero-amount entries", () => {
  const r = shapeRawExtraction({
    costAssumptions: {
      fixedCostCategories: [
        { name: "Dealership Operations", annualAmount: 1_680_000, evidence: "$140k/mo" },
        { name: "Service Payroll", annualAmount: 1_140_000, evidence: "$95k/mo" },
        { name: "", annualAmount: 100 }, // dropped
        { name: "Bad", annualAmount: 0 }, // dropped
      ],
    },
  });
  const fixed = r.partial.costAssumptions?.fixedCostCategories ?? [];
  assert.equal(fixed.length, 2);
  assert.deepEqual(
    fixed.map((c) => c.name),
    ["Dealership Operations", "Service Payroll"],
  );
});

test("shape: loanImpact wires existingDebt from monthly debt service", () => {
  const r = shapeRawExtraction({
    loanImpact: {
      loanAmount: 7_000_000,
      monthlyDebtService: 60_000,
      evidence: "$7M loan, ~$60k/mo debt service",
    },
  });
  assert.equal(r.partial.loanImpact?.loanAmount, 7_000_000);
  assert.equal(r.partial.loanImpact?.existingDebt?.length, 1);
  assert.equal(
    r.partial.loanImpact?.existingDebt?.[0].monthlyPayment,
    60_000,
  );
});

test("shape: management team preserves name + title; bio comes from evidence", () => {
  const r = shapeRawExtraction({
    managementTeam: [
      { name: "Sebrina Colon", title: "GM", evidence: "20 years dealership ops" },
      { name: "Sabrine Arroz", title: "Finance Director", evidence: "15 years auto finance" },
      { name: "", title: "Bad" }, // dropped
    ],
  });
  const team = r.partial.managementTeam ?? [];
  assert.equal(team.length, 2);
  assert.equal(team[0].name, "Sebrina Colon");
  assert.equal(team[0].title, "GM");
  assert.equal(team[0].bio, "20 years dealership ops");
  assert.equal(team[1].name, "Sabrine Arroz");
});

test("shape: no input → empty partial, no evidence", () => {
  const r = shapeRawExtraction({});
  assert.deepEqual(r.partial, {});
  assert.deepEqual(r.evidence, {});
});

// ── extractAssumptionsFromConversation: integration with stubbed Gemini ──

test("extract: returns null for empty history", async () => {
  const r = await extractAssumptionsFromConversation({ history: [] });
  assert.equal(r, null);
});

test("extract: passes through stubbed Gemini result and shapes it", async () => {
  let gotPrompt = "";
  const fakeCall: typeof import("@/lib/ai/geminiClient").callGeminiJSON = (async (
    opts: any,
  ) => {
    gotPrompt = opts.prompt as string;
    return {
      ok: true,
      result: {
        revenueStreams: [
          { name: "Auto Sales", baseAnnualRevenue: 3_150_000, evidence: "70-80 cars/mo at $3500/unit" },
        ],
        managementTeam: [
          { name: "Sebrina Colon", title: "GM", evidence: "20 years in dealerships" },
        ],
      },
      latencyMs: 1,
      attempts: 1,
    };
  }) as any;

  const r = await extractAssumptionsFromConversation({
    history: [
      { role: "user", content: "we sell about 70 to 80 cars a month at $3500 gross per unit" },
      { role: "assistant", content: "Got it. Who's your GM?" },
      { role: "user", content: "Sebrina Colon, she's been with us 20 years" },
    ],
    callJson: fakeCall,
  });

  assert.ok(r);
  assert.equal(r!.partial.revenueStreams?.[0].name, "Auto Sales");
  assert.equal(r!.partial.managementTeam?.[0].name, "Sebrina Colon");
  assert.ok(gotPrompt.includes("70 to 80 cars"));
  assert.ok(gotPrompt.includes("USER:"), "transcript labels include role");
});

test("extract: returns null when Gemini reports failure (caller falls back)", async () => {
  const fakeCall: typeof import("@/lib/ai/geminiClient").callGeminiJSON = (async () => ({
    ok: false,
    result: null,
    latencyMs: 5,
    attempts: 3,
    error: "GEMINI_API_KEY missing",
  })) as any;

  const r = await extractAssumptionsFromConversation({
    history: [{ role: "user", content: "hi" }],
    callJson: fakeCall,
  });
  assert.equal(r, null);
});

// ── End-to-end: extracted layer through buildCandidate + validator ──

test("end-to-end: borrower's three-business deal passes the SBA validator", () => {
  const bootstrap = require("../sbaAssumptionsBootstrap") as typeof import("../sbaAssumptionsBootstrap");
  const buildCandidate = bootstrap.__test_buildCandidate;

  const conversationLayer = shapeRawExtraction({
    revenueStreams: [
      { name: "Auto Sales", baseAnnualRevenue: 3_150_000 },
      { name: "Service Department", baseAnnualRevenue: 2_160_000 },
      { name: "Tire Shop", baseAnnualRevenue: 240_000 },
    ],
    costAssumptions: {
      cogsPercentYear1: 0.7,
      fixedCostCategories: [
        { name: "Dealership Operations", annualAmount: 1_680_000 },
        { name: "Service Payroll", annualAmount: 1_140_000 },
      ],
      plannedHires: [
        { role: "Service Technician", annualSalary: 65_000, headcount: 18 },
        { role: "Salesperson", annualSalary: 55_000, headcount: 9 },
      ],
    },
    loanImpact: { loanAmount: 7_000_000, monthlyDebtService: 60_000 },
    managementTeam: [
      { name: "Sebrina Colon", title: "GM", evidence: "20 years operating dealerships and service centers." },
      { name: "Sabrine Arroz", title: "Finance Director", evidence: "15 years in auto finance and SBA structuring." },
    ],
  }).partial;

  // Empty prefill (typical for borrower-portal anonymous deal — no
  // ownership entities, no uploaded financials).
  const emptyPrefill = {
    revenueStreams: [],
    costAssumptions: {
      cogsPercentYear1: 0.5,
      cogsPercentYear2: 0.5,
      cogsPercentYear3: 0.5,
      fixedCostCategories: [],
      plannedHires: [],
      plannedCapex: [],
    },
    workingCapital: { targetDSO: 45, targetDPO: 30, inventoryTurns: null },
    loanImpact: {
      loanAmount: 0,
      termMonths: 120,
      interestRate: 0.0725,
      existingDebt: [],
      equityInjectionAmount: 0,
      equityInjectionSource: "cash_savings" as const,
      sellerFinancingAmount: 0,
      sellerFinancingTermMonths: 0,
      sellerFinancingRate: 0,
      otherSources: [],
    },
    managementTeam: [],
  };

  const c = buildCandidate({
    dealId: "deal-three-businesses",
    prefill: emptyPrefill,
    existingRow: null,
    conversationLayer,
    conciergeFacts: null,
  });

  // Three streams, three borrower-quoted businesses, in the candidate.
  assert.equal(c.revenueStreams.length, 3);
  assert.deepEqual(
    c.revenueStreams.map((s) => s.name),
    ["Auto Sales", "Service Department", "Tire Shop"],
  );

  // Loan amount made it through.
  assert.equal(c.loanImpact.loanAmount, 7_000_000);
  assert.equal(c.loanImpact.existingDebt?.[0].monthlyPayment, 60_000);

  // Both named principals present, with their borrower-stated bios.
  assert.equal(c.managementTeam.length, 2);
  assert.equal(c.managementTeam[0].name, "Sebrina Colon");
  assert.equal(c.managementTeam[1].name, "Sabrine Arroz");

  // The whole assembly passes validation — preview generation can proceed.
  const v = validateSBAAssumptions(c);
  assert.equal(v.ok, true, JSON.stringify(v));
});
