import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();

const require = createRequire(import.meta.url);
const { normalizeNarrativeForPdf, renderSBAPackagePDF } =
  require("../sbaPackageRenderer") as typeof import("../sbaPackageRenderer");

test("normalizes fenced JSON and removes Markdown presentation syntax", () => {
  const raw = "```json\n" + JSON.stringify({
    section: "**Precision machining** — borrower-specific narrative.",
  }) + "\n```";
  const result = normalizeNarrativeForPdf(raw);
  assert.equal(result, "Precision machining — borrower-specific narrative.");
  assert.doesNotMatch(result, /```|\{|\}|\*\*/);
});

test("fails safely instead of printing malformed JSON", () => {
  assert.equal(
    normalizeNarrativeForPdf("```json\n{broken}\n```"),
    "Narrative unavailable due to an invalid generation response.",
  );
});

test("renders one physical page per logical page without footer-created blanks", async () => {
  const year = (n: 0 | 1 | 2 | 3) => ({
    year: n,
    label: n === 0 ? "Actual" : "Projected",
    revenue: 1_000_000 + n * 100_000,
    cogs: 500_000,
    grossProfit: 500_000,
    grossMarginPct: 0.5,
    operatingExpenses: 250_000,
    ebitda: 250_000,
    depreciation: 20_000,
    ebit: 230_000,
    interestExpense: 30_000,
    taxEstimate: 40_000,
    netIncome: 160_000,
    totalDebtService: 100_000,
    dscr: 2.5,
  });
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    revenue: 100_000,
    operatingDisbursements: 70_000,
    netOperatingCF: 30_000,
    debtService: 8_000,
    netCash: 22_000,
    cumulativeCash: (i + 1) * 22_000,
  }));
  const scenarios = (["base", "upside", "downside"] as const).map((name, i) => ({
    name,
    label: name[0].toUpperCase() + name.slice(1),
    revenueGrowthAdjustment: 0,
    cogsAdjustment: 0,
    dscrYear1: 2.5 - i * 0.3,
    dscrYear2: 2.6 - i * 0.3,
    dscrYear3: 2.7 - i * 0.3,
    revenueYear1: 1_100_000,
    ebitdaMarginYear1: 0.2,
    passesSBAThreshold: true,
  }));
  const pdf = await renderSBAPackagePDF({
    dealName: "QA Borrower",
    loanType: "SBA",
    loanAmount: 500_000,
    baseYear: year(0),
    annualProjections: [year(1), year(2), year(3)],
    monthlyProjections: monthly,
    breakEven: {
      fixedCostsAnnual: 250_000,
      contributionMarginPct: 0.5,
      breakEvenRevenue: 500_000,
      breakEvenUnits: null,
      projectedRevenueYear1: 1_100_000,
      marginOfSafetyPct: 0.55,
      flagLowMargin: false,
    },
    sensitivityScenarios: scenarios,
    useOfProceeds: [{ category: "Equipment", description: "Machine", amount: 500_000, pctOfTotal: 1 }],
    businessOverviewNarrative: "A concise, borrower-specific company description.",
    sensitivityNarrative: "The base case maintains adequate debt-service coverage.",
    managementTeam: [],
    executiveSummary: "A concise executive summary.",
    industryAnalysis: "A concise industry analysis.",
    marketingStrategy: "A concise marketing strategy.",
    operationsPlan: "A concise operations plan.",
    swotStrengths: "• Experienced management.",
    swotWeaknesses: "• Customer concentration.",
    swotOpportunities: "• Additional capacity.",
    swotThreats: "• Input-cost volatility.",
  } as any);

  const parsed = await PDFDocument.load(pdf);
  assert.equal(parsed.getPageCount(), 16);
});
