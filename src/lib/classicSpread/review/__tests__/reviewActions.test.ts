import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { SpreadAuditResult, SpreadAuditFinding, SpreadAuditStatement } from "../../audit/spreadAccuracyAudit";
import { buildClassicSpreadReviewActions, reviewFindingKey } from "../buildReviewActions";
import { applyReviewDecisions, type ReviewDecision } from "../applyReviewDecisions";

function finding(over: Partial<SpreadAuditFinding> & { period: string; statement: SpreadAuditStatement; rowLabel: string; issueType: SpreadAuditFinding["issueType"]; severity: SpreadAuditFinding["severity"] }): SpreadAuditFinding {
  return {
    expectedValue: null, actualValue: null, difference: null, tolerance: 1,
    sourceFactIds: [], documentIds: [], detail: "x", ...over,
  };
}

// The 4 OmniCare v13 blocker findings (+ one warning, to prove the builder filters to blockers).
function omniCareAudit(): SpreadAuditResult {
  const findings: SpreadAuditFinding[] = [
    finding({ period: "2023", statement: "income_statement", rowLabel: "GROSS PROFIT", issueType: "formula_mismatch", severity: "blocker", expectedValue: 400_000, actualValue: 350_000, difference: -50_000, detail: "GP conflict" }),
    finding({ period: "2024", statement: "balance_sheet", rowLabel: "TOTAL NET WORTH", issueType: "rejected_source_value", severity: "blocker", expectedValue: 4_512_938, actualValue: 6_800_000, difference: 2_287_062, detail: "rejected SL_TOTAL_EQUITY", documentIds: ["doc-2024"] }),
    finding({ period: "2025", statement: "balance_sheet", rowLabel: "TOTAL CURRENT ASSETS", issueType: "rejected_source_value", severity: "blocker", expectedValue: 3_133_066, actualValue: 2_393_922, difference: -739_144, detail: "rejected direct TCA" }),
    finding({ period: "2026", statement: "balance_sheet", rowLabel: "TOTAL CURRENT ASSETS", issueType: "missing_implied_component", severity: "blocker", expectedValue: 2_898_652, actualValue: 198_693, difference: 2_898_652, detail: "implied AR" }),
    finding({ period: "2026", statement: "balance_sheet", rowLabel: "TOTAL NON-CURRENT ASSETS", issueType: "unreconciled_total", severity: "warning", detail: "downgraded TNCA" }),
  ];
  return {
    status: "blocker",
    findings,
    summary: { blockers: 4, warnings: 1, infos: 0, periodsAudited: ["2023", "2024", "2025", "2026"], footingsChecked: 20, mappedFactKeys: 10, unmappedFactKeys: 0 },
    blockedCells: findings.filter((f) => f.severity === "blocker").map((f) => ({ period: f.period, statement: f.statement, rowLabel: f.rowLabel })),
    actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: 4, actions: [] },
  };
}

describe("buildClassicSpreadReviewActions", () => {
  it("produces exactly 4 OmniCare blocker review actions (warnings excluded)", () => {
    const actions = buildClassicSpreadReviewActions(omniCareAudit());
    assert.equal(actions.length, 4);
    assert.deepEqual(actions.map((a) => a.periodLabel).sort(), ["2023", "2024", "2025", "2026"]);
  });

  it("emits deterministic, stable, normalized finding keys", () => {
    const a1 = buildClassicSpreadReviewActions(omniCareAudit()).map((a) => a.findingKey);
    const a2 = buildClassicSpreadReviewActions(omniCareAudit()).map((a) => a.findingKey);
    assert.deepEqual(a1, a2);
    assert.equal(
      reviewFindingKey({ period: "2024", statement: "balance_sheet", rowLabel: "TOTAL NET WORTH", issueType: "rejected_source_value" }),
      "2024|balance_sheet|total_net_worth|rejected_source_value",
    );
  });

  it("a re-build does not duplicate keys (idempotent sync key set)", () => {
    const keys = buildClassicSpreadReviewActions(omniCareAudit()).map((a) => a.findingKey);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("maps each blocker to its banker action type + carries values/doc", () => {
    const byPeriod = Object.fromEntries(buildClassicSpreadReviewActions(omniCareAudit()).map((a) => [a.periodLabel, a]));
    assert.equal(byPeriod["2023"]!.actionType, "VERIFY_SOURCE_LINE");
    assert.equal(byPeriod["2024"]!.actionType, "CONFIRM_RESOLVED_VALUE");
    assert.equal(byPeriod["2024"]!.recommendedValue, 4_512_938);
    assert.equal(byPeriod["2024"]!.sourceValue, 6_800_000);
    assert.equal(byPeriod["2024"]!.sourceDocumentId, "doc-2024");
    assert.equal(byPeriod["2025"]!.actionType, "CONFIRM_RESOLVED_VALUE");
    assert.equal(byPeriod["2026"]!.actionType, "REQUEST_SOURCE_DETAIL");
  });
});

describe("applyReviewDecisions", () => {
  const reviewed = (findingKey: string, status: ReviewDecision["status"]): ReviewDecision =>
    ({ findingKey, status, reviewedAt: "2026-06-15T00:00:00Z", reviewerUserId: "user-1" });
  const bsKey = (period: string, row: string, issue: string) =>
    reviewFindingKey({ period, statement: "balance_sheet", rowLabel: row, issueType: issue });

  it("confirming 2024 equity downgrades that blocker to a reviewed warning", () => {
    const out = applyReviewDecisions(omniCareAudit(), [reviewed(bsKey("2024", "TOTAL NET WORTH", "rejected_source_value"), "confirmed_resolved_value")]);
    assert.equal(out.summary.blockers, 3);
    const f = out.findings.find((x) => x.period === "2024" && x.rowLabel === "TOTAL NET WORTH")!;
    assert.equal(f.severity, "warning");
    assert.equal(f.reviewStatus, "confirmed_resolved_value");
    assert.equal(out.status, "blocker"); // 3 others still open
  });

  it("confirming 2025 TCA downgrades that blocker", () => {
    const out = applyReviewDecisions(omniCareAudit(), [reviewed(bsKey("2025", "TOTAL CURRENT ASSETS", "rejected_source_value"), "confirmed_resolved_value")]);
    assert.equal(out.findings.find((x) => x.period === "2025")!.severity, "warning");
  });

  it("requesting YTD 2026 AR keeps the blocker open but marks the request pending", () => {
    const out = applyReviewDecisions(omniCareAudit(), [reviewed(bsKey("2026", "TOTAL CURRENT ASSETS", "missing_implied_component"), "borrower_detail_requested")]);
    const f = out.findings.find((x) => x.period === "2026" && x.issueType === "missing_implied_component")!;
    assert.equal(f.severity, "blocker");
    assert.equal(f.reviewStatus, "borrower_detail_requested");
    assert.match(f.detail, /pending/);
  });

  it("source-verifying 2023 Gross Profit clears that blocker to info", () => {
    const key = reviewFindingKey({ period: "2023", statement: "income_statement", rowLabel: "GROSS PROFIT", issueType: "formula_mismatch" });
    const out = applyReviewDecisions(omniCareAudit(), [reviewed(key, "source_verified")]);
    assert.equal(out.findings.find((x) => x.period === "2023")!.severity, "info");
  });

  it("confirming ALL 4 blockers leaves status warning (reviewed), never clean", () => {
    const out = applyReviewDecisions(omniCareAudit(), [
      reviewed(reviewFindingKey({ period: "2023", statement: "income_statement", rowLabel: "GROSS PROFIT", issueType: "formula_mismatch" }), "source_verified"),
      reviewed(bsKey("2024", "TOTAL NET WORTH", "rejected_source_value"), "confirmed_resolved_value"),
      reviewed(bsKey("2025", "TOTAL CURRENT ASSETS", "rejected_source_value"), "confirmed_resolved_value"),
      reviewed(bsKey("2026", "TOTAL CURRENT ASSETS", "missing_implied_component"), "waived"),
    ]);
    assert.equal(out.summary.blockers, 0);
    assert.equal(out.status, "warning"); // not clean — reviewed warnings remain
  });

  it("NEVER clears a blocker without reviewed_at + reviewer_user_id (anti silent auto-clear)", () => {
    const out = applyReviewDecisions(omniCareAudit(), [
      { findingKey: bsKey("2024", "TOTAL NET WORTH", "rejected_source_value"), status: "confirmed_resolved_value", reviewedAt: null, reviewerUserId: null },
    ]);
    assert.equal(out.summary.blockers, 4); // unchanged
  });
});

describe("buildClassicSpreadReviewActions — period enrichment (SOURCE-DETAIL-REQUEST-1)", () => {
  const periods = [
    { label: "2025", date: "12/31/2025", stmtType: "Annual" },
    { label: "2026", date: "3/31/2026", stmtType: "Interim" },
  ];

  it("carries the resolved period end date + interim flag into finding_json when periods are supplied", () => {
    const byPeriod = Object.fromEntries(
      buildClassicSpreadReviewActions(omniCareAudit(), periods).map((a) => [a.periodLabel, a]),
    );
    assert.equal(byPeriod["2026"]!.findingJson.periodEndDate, "3/31/2026");
    assert.equal(byPeriod["2026"]!.findingJson.periodIsInterim, true);
    assert.equal(byPeriod["2025"]!.findingJson.periodEndDate, "12/31/2025");
    assert.equal(byPeriod["2025"]!.findingJson.periodIsInterim, false);
  });

  it("is back-compatible: omitting periods yields a null end date (no crash)", () => {
    const a = buildClassicSpreadReviewActions(omniCareAudit());
    assert.equal(a[0]!.findingJson.periodEndDate, null);
  });
});
