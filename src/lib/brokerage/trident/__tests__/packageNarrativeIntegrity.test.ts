import test from "node:test";
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
  assert.doesNotThrow(() => assertPackageNarrativeIntegrity(pkg, financial));
  pkg.operations_plan = pkg.operations_plan.replace("Working capital", "Equipment");
  assert.throws(() => assertPackageNarrativeIntegrity(pkg, financial), /operations_plan/);
});
