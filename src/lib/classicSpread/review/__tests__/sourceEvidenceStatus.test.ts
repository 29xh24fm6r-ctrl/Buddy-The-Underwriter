/**
 * SPEC-SPREAD-SOURCE-EVIDENCE-CLEARING-WORKFLOW-1 — pure evidence-status lifecycle model.
 *
 * Proves honest Needed -> Requested -> Uploaded -> Extracted -> Cleared/Still-blocking semantics:
 * request/upload/extraction never imply "cleared"; only a settled (closed/pruned) action means the
 * finding is gone. OmniCare-shaped fixtures (3/31/2026 TCA + 4/2026 AR aging; 2022 Schedule L TLNW)
 * are fixtures, not hard-coded paths.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSourceEvidenceStatus,
  type EvidenceCandidateDoc,
  type EvidenceReviewAction,
  type EvidenceDraftRequest,
} from "../sourceEvidenceStatus";

const doc = (over: Partial<EvidenceCandidateDoc> & { id: string; filename: string }): EvidenceCandidateDoc => ({
  canonicalType: null, checklistKey: null, documentLabel: null, periodEnd: null, taxYear: null,
  extractionStatus: "extracted", isActive: true, ...over,
});

const tcaAction = (over: Partial<EvidenceReviewAction> = {}): EvidenceReviewAction => ({
  id: "ra-tca", findingKey: "ytd_2026|balance_sheet|total_current_assets|missing_implied_component",
  actionType: "REQUEST_SOURCE_DETAIL", issueType: "missing_implied_component", statement: "balance_sheet",
  periodLabel: "YTD 2026", rowLabel: "TOTAL CURRENT ASSETS", status: "borrower_detail_requested",
  sourceValue: 198_692.59, recommendedValue: 2_898_652.37, diffValue: 2_898_652.37,
  periodEndDate: "3/31/2026", periodIsInterim: true, ...over,
});

const tlnwAction = (over: Partial<EvidenceReviewAction> = {}): EvidenceReviewAction => ({
  id: "ra-tlnw", findingKey: "2022|balance_sheet|total_liabilities_&_net_worth|unreconciled_total",
  actionType: "VERIFY_SOURCE_LINE", issueType: "unreconciled_total", statement: "balance_sheet",
  periodLabel: "2022", rowLabel: "TOTAL LIABILITIES & NET WORTH", status: "open",
  sourceValue: 1_489_099, recommendedValue: 3_268_740, diffValue: 1_779_641,
  periodEndDate: "12/31/2022", periodIsInterim: false, ...over,
});

const marchBs = doc({ id: "bs-mar", filename: "Omnicare 365 Balance Sheet March 2026.pdf", canonicalType: "BALANCE_SHEET", taxYear: 2026, checklistKey: "FIN_STMT_BS_CURRENT" });
const aprAr = doc({ id: "ar-apr", filename: "Omnicare 365 AR Aging 4-2026.pdf", canonicalType: "AR_AGING", taxYear: 2026, checklistKey: "AR_AGING" });
const tr2022 = doc({ id: "tr-2022", filename: "Omnicare 365 1120 2022.pdf", canonicalType: "BUSINESS_TAX_RETURN", taxYear: 2022, checklistKey: "IRS_BUSINESS_2022" });

describe("YTD 2026 TCA — exact BS + wrong-date AR aging", () => {
  const s = buildSourceEvidenceStatus({ action: tcaAction(), documents: [marchBs, aprAr] });

  it("required evidence names the period and the tie-out total", () => {
    assert.match(s.requiredEvidenceSummary, /3\/31\/2026 current-asset detail or AR aging/);
    assert.match(s.requiredEvidenceSummary, /Total Current Assets of \$3,097,345/);
  });

  it("upload status is candidate_uploaded_needs_bridge (AR aging is wrong month)", () => {
    assert.equal(s.uploadStatus, "candidate_uploaded_needs_bridge");
  });

  it("still blocking with a bridge reason, NOT cleared (upload/extract != cleared)", () => {
    assert.equal(s.clearingStatus, "still_blocking");
    assert.match(s.blockingReason!, /reconciliation bridge/i);
    assert.match(s.blockingReason!, /No 3\/31\/2026 AR\/current-asset detail or bridge has been consumed/);
    assert.equal(s.statusTone, "blocker");
  });

  it("lists both candidate documents with their period match + the bridge note", () => {
    const ar = s.matchingDocuments.find((m) => m.id === "ar-apr")!;
    const bs = s.matchingDocuments.find((m) => m.id === "bs-mar")!;
    assert.equal(ar.periodMatch, "same_year");
    assert.equal(ar.role, "clearing");
    assert.match(ar.note!, /bridge/i);
    assert.equal(bs.periodMatch, "exact");
    assert.equal(bs.role, "context"); // the consumed balance sheet does not itself clear it
  });

  it("borrower detail already requested → requested, awaiting bridge/upload", () => {
    assert.equal(s.requestStatus, "requested");
    assert.match(s.nextActionLabel, /bridge/i);
  });
});

describe("YTD 2026 TCA — exact-period AR aging uploaded + extracted (active finding)", () => {
  it("needs_regenerate: the new exact-period AR detail exists but has not been consumed yet", () => {
    const exactAr = doc({ id: "ar-mar", filename: "Omnicare AR Aging 3-2026.pdf", canonicalType: "AR_AGING", taxYear: 2026, periodEnd: "2026-03-31" });
    const s = buildSourceEvidenceStatus({ action: tcaAction(), documents: [exactAr] });
    assert.equal(s.uploadStatus, "candidate_uploaded_extracted");
    assert.equal(s.clearingStatus, "needs_regenerate");
    assert.equal(s.statusTone, "warning");
    assert.match(s.nextActionLabel, /[Rr]egenerate/);
  });
});

describe("clearing only after the action is settled (finding pruned)", () => {
  it("a closed action reads cleared_after_regenerate", () => {
    const s = buildSourceEvidenceStatus({ action: tcaAction({ status: "closed" }), documents: [marchBs, aprAr] });
    assert.equal(s.clearingStatus, "cleared_after_regenerate");
    assert.equal(s.statusTone, "success");
  });
  it("source_verified is also settled", () => {
    const s = buildSourceEvidenceStatus({ action: tcaAction({ status: "source_verified" }), documents: [marchBs] });
    assert.equal(s.clearingStatus, "cleared_after_regenerate");
  });
});

describe("2022 TLNW — Schedule L candidate but unresolved", () => {
  const s = buildSourceEvidenceStatus({ action: tlnwAction(), documents: [tr2022] });

  it("required evidence references Total Assets and Liabilities + Net Worth", () => {
    assert.match(s.requiredEvidenceSummary, /2022 Schedule L source detail/);
    assert.match(s.requiredEvidenceSummary, /Total Assets of \$3,268,740/);
    assert.match(s.requiredEvidenceSummary, /Liabilities \+ Net Worth/);
  });

  it("the 2022 tax return is an exact-period extracted candidate but still blocking", () => {
    const tr = s.matchingDocuments.find((m) => m.id === "tr-2022")!;
    assert.equal(tr.periodMatch, "exact"); // annual: same year is exact
    assert.equal(s.clearingStatus, "still_blocking"); // Schedule L liability side incomplete
    assert.match(s.blockingReason!, /Schedule L liability\/equity side does not reconcile/);
  });

  it("no request yet (banker has not clicked) → not_requested, action = Request borrower detail", () => {
    assert.equal(s.requestStatus, "not_requested");
    assert.equal(s.nextActionLabel, "Request borrower detail");
  });
});

describe("request linkage + warnings", () => {
  it("a draft linked by finding_key marks the action requested", () => {
    const drafts: EvidenceDraftRequest[] = [{ id: "d1", status: "pending_approval", sourceFindingKey: tlnwAction().findingKey, sourceReviewActionId: null }];
    const s = buildSourceEvidenceStatus({ action: tlnwAction(), documents: [tr2022], draftRequests: drafts });
    assert.equal(s.requestStatus, "requested");
    assert.equal(s.requestWarning, null);
  });

  it("borrower_detail_requested with NO linked draft surfaces a warning", () => {
    const s = buildSourceEvidenceStatus({ action: tcaAction({ status: "borrower_detail_requested" }), documents: [], draftRequests: [] });
    assert.equal(s.requestStatus, "requested");
    assert.match(s.requestWarning!, /no linked borrower request was found/i);
    assert.equal(s.uploadStatus, "no_candidate_uploaded");
  });

  it("a draft linked by review-action id also counts", () => {
    const drafts: EvidenceDraftRequest[] = [{ id: "d2", status: "sent", sourceFindingKey: null, sourceReviewActionId: "ra-tca" }];
    const s = buildSourceEvidenceStatus({ action: tcaAction({ status: "open" }), documents: [marchBs, aprAr], draftRequests: drafts });
    assert.equal(s.requestStatus, "requested");
  });
});

describe("income-statement + generic", () => {
  it("income-statement source-line blocker matches the same-period income statement", () => {
    const is2025 = doc({ id: "is-2025", filename: "Income Statement 2025.pdf", canonicalType: "INCOME_STATEMENT", taxYear: 2025 });
    const a: EvidenceReviewAction = {
      id: "ra-is", findingKey: "2025|income_statement|other_deductions|missing_required_value",
      actionType: "REQUEST_SOURCE_DETAIL", issueType: "missing_required_value", statement: "income_statement",
      periodLabel: "2025", rowLabel: "OTHER DEDUCTIONS", status: "open",
      sourceValue: null, recommendedValue: 120_000, diffValue: 120_000, periodEndDate: "12/31/2025", periodIsInterim: false,
    };
    const s = buildSourceEvidenceStatus({ action: a, documents: [is2025] });
    assert.match(s.requiredEvidenceSummary, /income-statement detail/i);
    assert.equal(s.matchingDocuments.find((m) => m.id === "is-2025")!.periodMatch, "exact");
  });

  it("no candidate documents → no_candidate_uploaded / not_started", () => {
    const s = buildSourceEvidenceStatus({ action: tcaAction({ status: "open" }), documents: [] });
    assert.equal(s.uploadStatus, "no_candidate_uploaded");
    assert.equal(s.extractionStatus, "not_started");
    assert.equal(s.clearingStatus, "still_blocking");
  });
});
