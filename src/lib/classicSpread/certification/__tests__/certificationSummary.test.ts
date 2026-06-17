/**
 * SPEC-CLASSIC-SPREAD-CERTIFICATION-GATE-PDF-VERSION-1 — certification summary roll-up.
 *
 * Proves the honest certified/preliminary/blocked status, that closed/pruned review actions don't
 * count as open blockers, the OmniCare-shaped case (only the YTD-2026 source-detail request remains,
 * overall NOT certified), the rendered certification-status content, and the render-version bump.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildClassicSpreadCertificationSummary,
  certificationStatusLines,
} from "../certificationSummary";
import type { ClassicSpreadCertificationAudit } from "../certifiedSpreadGateCore";
import type { SpreadAuditFinding, SpreadAuditResult } from "../../audit/spreadAccuracyAudit";
import { CLASSIC_PDF_RENDER_VERSION } from "../../classicPdfRenderVersion";

const finding = (
  rowLabel: string,
  issueType: SpreadAuditFinding["issueType"],
  severity: SpreadAuditFinding["severity"],
  period = "2026",
  statement: SpreadAuditFinding["statement"] = "balance_sheet",
): SpreadAuditFinding => ({
  period, statement, rowLabel, issueType,
  expectedValue: null, actualValue: null, difference: null, tolerance: 1,
  sourceFactIds: [], documentIds: [], severity, detail: `${rowLabel} ${issueType}`,
});

const spreadAccuracy = (findings: SpreadAuditFinding[]): SpreadAuditResult => ({
  status: findings.some((f) => f.severity === "blocker") ? "blocker" : findings.some((f) => f.severity === "warning") ? "warning" : "clean",
  findings,
  summary: { blockers: 0, warnings: 0, infos: 0, periodsAudited: [], footingsChecked: 0, mappedFactKeys: 0, unmappedFactKeys: 0 },
  blockedCells: [],
  actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: 0, actions: [] },
});

const audit = (
  findings: SpreadAuditFinding[],
  domainStatuses: ("clean" | "caveated" | "blocked")[] = ["clean", "clean", "clean", "clean"],
): ClassicSpreadCertificationAudit => ({
  certificationVersion: CLASSIC_PDF_RENDER_VERSION,
  domains: {
    balance_sheet: { status: domainStatuses[0]!, blocked: [] },
    personal_income: { status: domainStatuses[1]!, replacements: [] },
    global_cash_flow: { status: domainStatuses[2]!, preliminary: false, blocked: [] },
    ratios: { status: domainStatuses[3]!, suppressed: [] },
  },
  dependencyStatuses: { personalIncome: "ok" },
  suppressions: [],
  spreadAccuracy: spreadAccuracy(findings),
});

describe("buildClassicSpreadCertificationSummary", () => {
  it("is BLOCKED when a blocker finding exists", () => {
    const s = buildClassicSpreadCertificationSummary({ certified: true, audit: audit([finding("TOTAL CURRENT ASSETS", "missing_implied_component", "blocker")]) });
    assert.equal(s.status, "blocked");
    assert.equal(s.blockerCount, 1);
  });

  it("is PRELIMINARY when only warnings remain", () => {
    const s = buildClassicSpreadCertificationSummary({
      certified: true,
      audit: audit([finding("TOTAL CURRENT ASSETS", "rejected_source_value", "warning", "2025")]),
      openReviewActionCount: 0,
    });
    assert.equal(s.status, "preliminary");
    assert.equal(s.blockerCount, 0);
    assert.equal(s.warningCount, 1);
    assert.equal(s.remainingRequiredActions.length, 0);
  });

  it("closed/pruned review actions do not count as open blockers", () => {
    // post-decision audit has no blocker findings; the persisted open count is 0 → not blocked.
    const s = buildClassicSpreadCertificationSummary({
      certified: true,
      audit: audit([finding("GROSS PROFIT", "formula_mismatch", "warning", "2023", "income_statement")]),
      openReviewActionCount: 0,
    });
    assert.equal(s.status, "preliminary");
    assert.equal(s.openReviewActionCount, 0);
  });

  it("is CERTIFIED only when domains clean, audit clean, and no open actions", () => {
    const s = buildClassicSpreadCertificationSummary({ certified: true, audit: audit([]), openReviewActionCount: 0 });
    assert.equal(s.status, "certified");
    assert.equal(s.certifiedCount, 4);
  });

  it("fails closed to BLOCKED when the gate did not complete", () => {
    const s = buildClassicSpreadCertificationSummary({ certified: false, audit: null });
    assert.equal(s.status, "blocked");
    assert.match(s.notes.join(" "), /did not complete/i);
  });

  // ── OmniCare current truth ──────────────────────────────────────────────────────────────────
  it("OmniCare: 2025 TCA warning + decided 2024/2023 + remaining YTD-2026 source detail → BLOCKED, not certified", () => {
    // 2024 TNW and 2023 GP were banker-decided and already downgraded out of the blocker set by
    // applyReviewDecisions, so they are not present as blocker findings here.
    const s = buildClassicSpreadCertificationSummary({
      certified: true,
      audit: audit([
        finding("TOTAL CURRENT ASSETS", "rejected_source_value", "warning", "2025"), // 2025 TCA preliminary
        finding("TOTAL CURRENT ASSETS", "missing_implied_component", "blocker", "2026"), // YTD-2026 source detail
      ]),
      openReviewActionCount: 1,
    });
    assert.equal(s.status, "blocked");
    assert.notEqual(s.status, "certified");
    assert.equal(s.remainingRequiredActions.length, 1);
    assert.deepEqual(s.remainingRequiredActions[0], {
      period: "2026", statement: "balance_sheet", rowLabel: "TOTAL CURRENT ASSETS", action: "REQUEST_SOURCE_DETAIL",
    });
    assert.match(s.notes.join(" "), /Source detail still required for: 2026 TOTAL CURRENT ASSETS/);
  });
});

describe("certificationStatusLines (rendered PDF content)", () => {
  it("includes a Spread Certification status header and the remaining action", () => {
    const s = buildClassicSpreadCertificationSummary({
      certified: true,
      audit: audit([finding("TOTAL CURRENT ASSETS", "missing_implied_component", "blocker", "2026")]),
      openReviewActionCount: 1,
    });
    const lines = certificationStatusLines(s);
    assert.match(lines[0]!, /Spread Certification: BLOCKED/);
    assert.ok(lines.some((l) => /REQUEST_SOURCE_DETAIL.*2026.*TOTAL CURRENT ASSETS/.test(l)));
  });

  it("renders the CERTIFIED header when fully clean", () => {
    const lines = certificationStatusLines(buildClassicSpreadCertificationSummary({ certified: true, audit: audit([]), openReviewActionCount: 0 }));
    assert.match(lines[0]!, /Spread Certification: CERTIFIED/);
  });
});

describe("render version", () => {
  it("CLASSIC_PDF_RENDER_VERSION is bumped to 16", () => {
    assert.equal(CLASSIC_PDF_RENDER_VERSION, 16);
  });
});
