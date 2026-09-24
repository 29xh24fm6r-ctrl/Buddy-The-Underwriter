import test from "node:test";
import { BUSINESS_PLAN_REQUIREMENTS } from "../narrativeAcceptance";
import assert from "node:assert/strict";
import { assertPackageNarrativeIntegrity } from "../packageNarrativeIntegrity";
import { fundingScheduleText, downsideDisclosure } from "@/lib/ai/packageNarrativeEvidence";

test("publication rechecks saved narratives even if their AI verdict says pass", () => {
  const financial: any = { sourcesAndUses: { sources: [{ label: "Loan", amount: 100 }], uses: [{ label: "Working capital", amount: 100 }], totalSources: 100, totalUses: 100 },
    projectionModel: { sensitivityScenarios: [{ name: "downside", dscrYear1: 1.44, dscrYear2: .77, dscrYear3: .14, passesSBAThreshold: false }] } };
  const pkg = { verification_verdict: "pass", operations_plan: "Funds cover equipment.", executive_summary: "Strong base DSCR supports repayment." };
  assert.throws(() => assertPackageNarrativeIntegrity(pkg, financial), /operations_plan, executive_summary/);
  pkg.operations_plan = fundingScheduleText(financial.sourcesAndUses);
  pkg.executive_summary = downsideDisclosure(financial.projectionModel.sensitivityScenarios)!;
  const complete = { ...Object.fromEntries(Object.keys(BUSINESS_PLAN_REQUIREMENTS).map(key => [key, Array(50).fill("evidence").join(" ") + " " + downsideDisclosure(financial.projectionModel.sensitivityScenarios)])), ...pkg };
  complete.operations_plan += " " + downsideDisclosure(financial.projectionModel.sensitivityScenarios);
  complete.operations_plan += " " + Array(45).fill("evidence").join(" ");
  complete.executive_summary += " " + Array(45).fill("evidence").join(" ");
  assert.doesNotThrow(() => assertPackageNarrativeIntegrity(complete, financial));
  assert.throws(() => assertPackageNarrativeIntegrity({ ...complete, swot_opportunities: "Too short." }, financial), /sections are incomplete.*swot_opportunities/);
  pkg.operations_plan = pkg.operations_plan.replace("Working capital", "Equipment");
  assert.throws(() => assertPackageNarrativeIntegrity(pkg, financial), /operations_plan/);
});
