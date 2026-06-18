/**
 * SPEC-BORROWER-SPREAD-EVIDENCE-LAUNCH-HARDENING-1 — launch-risk edge cases for the borrower spread
 * evidence loop. These prove the conservative degrade-honestly guarantees the spec requires:
 *
 *   - a tile never renders blank (a borrower always sees a safe instruction);
 *   - a malformed draft with no forwardable linkage never renders a broken upload tile;
 *   - empty-string linkage degrades to a heuristic candidate (never LINKED, never fulfilling);
 *   - the regenerate CTA (regenerateRecommended) is NEVER set for not-yet-extracted, wrong-period, or
 *     context-only uploads — only genuinely consumable evidence drives regenerate.
 *
 * High-value over broad: each test pins one acceptance criterion. OmniCare-shaped fixtures, no DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildBorrowerSpreadRequestTiles,
  type SpreadRequestDraftRow,
  type SpreadRequestActionStatus,
} from "../borrowerPortalSpreadRequestTiles";
import { linkEvidenceUploads } from "../evidenceUploadLinker";
import {
  buildSourceEvidenceStatus,
  type EvidenceCandidateDoc,
  type EvidenceReviewAction,
} from "../sourceEvidenceStatus";

const TCA_FINDING = "ytd_2026|balance_sheet|total_current_assets|missing_implied_component";
const TCA_ACTION_ID = "ra-tca-2026";

const activeTcaAction: SpreadRequestActionStatus = {
  id: TCA_ACTION_ID,
  finding_key: TCA_FINDING,
  status: "borrower_detail_requested",
};

function spreadDraft(evOver: Record<string, any> = {}, rowOver: Partial<SpreadRequestDraftRow> = {}): SpreadRequestDraftRow {
  return {
    id: "draft-tca",
    status: "pending_approval",
    missing_document_type: "current_asset_detail",
    draft_subject: "Upload 3/31/2026 current asset detail",
    draft_message: "Please upload AR detail as of 3/31/2026.",
    evidence: [
      {
        source: "classic_spread_source_detail",
        source_finding_key: TCA_FINDING,
        source_review_action_id: TCA_ACTION_ID,
        requested_evidence_kind: "current_asset_detail",
        requested_period: "3/31/2026",
        clearing_target: "Total Current Assets of $3,097,345 as of 3/31/2026",
        acceptable_documents: ["3/31/2026 AR aging or AR detail"],
        banker_internal_note: "REQUEST_SOURCE_DETAIL ... internal diagnostics",
        ...evOver,
      },
    ],
    ...rowOver,
  };
}

describe("tile rendering — never blank, never broken", () => {
  it("an empty draft_message falls back to a safe, borrower-facing instruction (no banker copy)", () => {
    const draft = spreadDraft({}, { draft_message: "   " });
    const [t] = buildBorrowerSpreadRequestTiles({ drafts: [draft], actions: [activeTcaAction] });
    assert.ok(t, "tile should still render");
    assert.ok(t.description.trim().length > 0, "description must not be blank");
    assert.match(t.description, /Total Current Assets of \$3,097,345/); // built from clearing_target
    assert.ok(!t.description.toLowerCase().includes("internal"));
    assert.ok(!JSON.stringify(t).includes("banker_internal_note"));
  });

  it("with no clearing_target/message it still synthesizes an instruction from evidence kind + period", () => {
    const draft = spreadDraft({ clearing_target: undefined, acceptable_documents: [] }, { draft_message: "" });
    const [t] = buildBorrowerSpreadRequestTiles({ drafts: [draft], actions: [activeTcaAction] });
    assert.ok(t.description.trim().length > 0);
    assert.match(t.description, /current asset detail/i);
    assert.match(t.description, /3\/31\/2026/);
  });

  it("a malformed spread draft with NO review-action id and NO finding key never renders a tile", () => {
    // Has the spread source token (so it is recognized as a spread draft) but no forwardable linkage —
    // an upload could never become LINKED evidence, so the tile must not render.
    const draft = spreadDraft({ source_finding_key: null, source_review_action_id: null });
    const tiles = buildBorrowerSpreadRequestTiles({ drafts: [draft], actions: [activeTcaAction] });
    assert.equal(tiles.length, 0);
  });

  it("empty-string linkage keys are treated as absent (no tile)", () => {
    const draft = spreadDraft({ source_finding_key: "  ", source_review_action_id: "" });
    const tiles = buildBorrowerSpreadRequestTiles({ drafts: [draft], actions: [activeTcaAction] });
    assert.equal(tiles.length, 0);
  });
});

describe("linker — incomplete/empty metadata prefers candidate over linked", () => {
  const action: EvidenceReviewAction = {
    id: TCA_ACTION_ID, findingKey: TCA_FINDING, actionType: "REQUEST_SOURCE_DETAIL",
    issueType: "missing_implied_component", statement: "balance_sheet", periodLabel: "YTD 2026",
    rowLabel: "TOTAL CURRENT ASSETS", status: "borrower_detail_requested",
    sourceValue: 198_692.59, recommendedValue: 2_898_652.37, diffValue: 2_898_652.37,
    periodEndDate: "3/31/2026", periodIsInterim: true,
  };

  it("empty-string metadata linkage → candidate, not linked (never fulfills the request)", () => {
    const doc: EvidenceCandidateDoc = {
      id: "doc-x", filename: "AR Aging 3-31-2026.pdf", canonicalType: "AR_AGING", checklistKey: null,
      documentLabel: null, periodEnd: "2026-03-31", taxYear: 2026, extractionStatus: "extracted", isActive: true,
      linkedReviewActionId: "", linkedFindingKey: "", linkedDraftRequestId: "",
    };
    const res = linkEvidenceUploads({ action, documents: [doc], draftRequests: [] });
    assert.equal(res.linkedDocIds.length, 0);
    assert.equal(res.candidateDocuments.length, 1);
    assert.notEqual(res.linkageConfidence, "explicit");
  });

  it("a draft-id-only linkage with no draft record on file → candidate, not linked", () => {
    const doc: EvidenceCandidateDoc = {
      id: "doc-y", filename: "AR Aging.pdf", canonicalType: "AR_AGING", checklistKey: null,
      documentLabel: null, periodEnd: "2026-03-31", taxYear: 2026, extractionStatus: "extracted", isActive: true,
      linkedReviewActionId: null, linkedFindingKey: null, linkedDraftRequestId: "missing-draft",
    };
    const res = linkEvidenceUploads({ action, documents: [doc], draftRequests: [] });
    assert.equal(res.linkedDocIds.length, 0);
    assert.equal(res.candidateDocuments.length, 1);
  });
});

describe("regenerate CTA — never recommended for not-extracted / wrong-period / context-only", () => {
  const tcaAction = (over: Partial<EvidenceReviewAction> = {}): EvidenceReviewAction => ({
    id: TCA_ACTION_ID, findingKey: TCA_FINDING, actionType: "REQUEST_SOURCE_DETAIL",
    issueType: "missing_implied_component", statement: "balance_sheet", periodLabel: "YTD 2026",
    rowLabel: "TOTAL CURRENT ASSETS", status: "borrower_detail_requested",
    sourceValue: 198_692.59, recommendedValue: 2_898_652.37, diffValue: 2_898_652.37,
    periodEndDate: "3/31/2026", periodIsInterim: true, ...over,
  });
  const linkedDoc = (over: Partial<EvidenceCandidateDoc> & { id: string; filename: string }): EvidenceCandidateDoc => ({
    canonicalType: "AR_AGING", checklistKey: null, documentLabel: null, periodEnd: null, taxYear: 2026,
    extractionStatus: "extracted", isActive: true, linkedReviewActionId: TCA_ACTION_ID, ...over,
  });

  it("linked but NOT yet extracted → blocking, regenerate not recommended", () => {
    const s = buildSourceEvidenceStatus({
      action: tcaAction(),
      documents: [linkedDoc({ id: "lk", filename: "AR detail 3-31-2026.pdf", periodEnd: "2026-03-31", extractionStatus: "pending" })],
    });
    assert.equal(s.uploadStatus, "linked_evidence_uploaded");
    assert.equal(s.regenerateRecommended, false);
    assert.equal(s.clearingStatus, "still_blocking");
  });

  it("linked extracted but WRONG period with no bridge → blocking, regenerate not recommended", () => {
    const s = buildSourceEvidenceStatus({
      action: tcaAction(),
      documents: [linkedDoc({ id: "lk", filename: "AR Aging 4-2026.pdf", periodEnd: "2026-04-28" })],
    });
    assert.equal(s.regenerateRecommended, false);
    assert.equal(s.clearingStatus, "still_blocking");
  });

  it("a context-only candidate (the already-consumed balance sheet) → blocking, regenerate not recommended", () => {
    const marchBs: EvidenceCandidateDoc = {
      id: "bs", filename: "Balance Sheet March 2026.pdf", canonicalType: "BALANCE_SHEET", checklistKey: null,
      documentLabel: null, periodEnd: "2026-03-31", taxYear: 2026, extractionStatus: "extracted", isActive: true,
    };
    const s = buildSourceEvidenceStatus({ action: tcaAction(), documents: [marchBs] });
    assert.equal(s.regenerateRecommended, false);
    assert.equal(s.clearingStatus, "still_blocking");
  });

  it("documents-unavailable → blocking, regenerate not recommended (no false CTA)", () => {
    const s = buildSourceEvidenceStatus({ action: tcaAction(), documents: [], documentsUnavailable: true });
    assert.equal(s.regenerateRecommended, false);
    assert.equal(s.clearingStatus, "still_blocking");
  });
});
