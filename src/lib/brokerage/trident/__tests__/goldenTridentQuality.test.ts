import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { gradeGoldenTrident } = require("../goldenTridentQuality") as typeof import("../goldenTridentQuality");
const prose = "Evidence supported text ".repeat(30);
function fixture() {
  return {
    buddy_trident_bundles: { status: "succeeded", source_sba_package_id: "p", source_feasibility_id: "f", source_spread_id: "s", source_credit_memo_id: "m", canonical_memo_input_hash: "h", release_gate_json: { ok: true, warnings: [] }, business_plan_pdf_path: "p.pdf", projections_xlsx_path: "p.xlsx", feasibility_pdf_path: "f.pdf", credit_memo_pdf_path: "m.pdf", spreads_pdf_path: "s.pdf", sba_forms_pdf_path: "forms.pdf" },
    buddy_sba_packages: { ...Object.fromEntries(["business_overview_narrative", "executive_summary", "industry_analysis", "marketing_strategy", "operations_plan", "swot_strengths", "swot_weaknesses", "swot_opportunities", "swot_threats", "sensitivity_narrative", "plan_thesis", "projections_assumptions_narrative"].map(k => [k, prose])), milestone_timeline: {}, kpi_dashboard: {}, risk_contingency_matrix: {}, projections_annual: [1,2,3], projections_monthly: Array(12).fill(1), sensitivity_scenarios: [1,2,3], balance_sheet_projections: [1,2,3], sources_and_uses: { total: 1 }, verification_verdict: "pass" },
    buddy_feasibility_studies: { pdf_url: "f.pdf", composite_score: 80, market_demand_score: 80, financial_viability_score: 80, operational_readiness_score: 80, location_suitability_score: 80, data_completeness: 0.9, narratives: Object.fromEntries([1,2,3,4,5].map(k => [k,prose])), verification_verdict: "pass", narrative_citations: Object.fromEntries(["executiveSummary", "marketDemandNarrative", "locationSuitabilityNarrative"].map(k => [k,{precise:true,urls:["https://example.com/source"]}])) },
    deal_spreads: { status: "ready", rendered_json: { pdf_base64: "x".repeat(1001), pdf_sha256: "hash", canonicalFactsTimestamp: "now" } },
    canonical_memo_narratives: { input_hash: "h", narratives: { sections: Array(7).fill({content:prose}) }, model: "model", research_trust_grade: "committee_grade", generated_at: "now", metadata_json: { content_review: { version: 1, findings: [] as string[] } } },
  };
}
async function grade(rows: ReturnType<typeof fixture>) {
  const sb = { from: (name: string) => { const q: any = { select:()=>q, eq:()=>q, is:()=>q, order:()=>q, limit:()=>q, maybeSingle:async()=>({data:rows[name as keyof typeof rows]}) }; return q; } };
  return gradeGoldenTrident({ sb: sb as any, dealId: "d", bankId: "b" });
}
test("structural score cannot call uncited feasibility a pass", async () => {
  const rows = fixture();
  rows.buddy_feasibility_studies.narrative_citations = {};
  const report = await grade(rows);
  assert.equal(report.artifacts.find(a=>a.key==="feasibility")?.status, "review");
  assert.ok(report.overallScore <= 84);
});
test("long memo prose cannot hide unresolved structured evidence", async () => {
  const rows = fixture();
  rows.canonical_memo_narratives.metadata_json.content_review.findings = ["Verify the cash-flow adjustment bridge."];
  const report = await grade(rows);
  assert.equal(report.artifacts.find(a=>a.key==="creditMemo")?.status, "review");
  assert.ok(report.overallScore <= 84);
  assert.ok((await grade(fixture())).overallScore > 84);
});
