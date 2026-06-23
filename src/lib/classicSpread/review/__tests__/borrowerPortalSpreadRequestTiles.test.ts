/**
 * SPEC-BORROWER-PORTAL-SPREAD-REQUEST-TILES-1 — pure tile-projection tests.
 *
 * Proves classic-spread source-detail drafts become borrower upload tiles ONLY while their review
 * action is still active, that the tile forwards exact linkage so the upload becomes LINKED evidence,
 * and that the honest lifecycle holds (closed/pruned action ⇒ no tile; unrelated drafts ⇒ no tile).
 * OmniCare-shaped fixtures (YTD 2026 Total Current Assets; 2022 Schedule L). No DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildBorrowerSpreadRequestTiles,
  isSpreadSourceDetailDraft,
  type SpreadRequestDraftRow,
  type SpreadRequestActionStatus,
} from "../borrowerPortalSpreadRequestTiles";
import { linkEvidenceUploads } from "../evidenceUploadLinker";
import type { EvidenceCandidateDoc, EvidenceReviewAction } from "../sourceEvidenceStatus";

// ── OmniCare-shaped fixtures ────────────────────────────────────────────────────────────────────
const TCA_FINDING = "ytd_2026|balance_sheet|total_current_assets|missing_implied_component";
const TCA_ACTION_ID = "ra-tca-2026";

/** The draft package ensureBorrowerSourceDetailRequest writes for the YTD 2026 TCA request. */
function tcaDraft(over: Partial<SpreadRequestDraftRow> = {}): SpreadRequestDraftRow {
  return {
    id: "draft-tca",
    status: "pending_approval",
    missing_document_type: "current_asset_detail",
    draft_subject: "Upload 3/31/2026 current asset detail supporting Total Current Assets",
    draft_message:
      "Buddy needs source detail for the 3/31/2026 interim balance sheet. Please upload a detailed current-asset schedule, AR aging, AR detail, or detailed balance sheet as of 3/31/2026.",
    evidence: [
      {
        source: "classic_spread_source_detail",
        source_finding_key: TCA_FINDING,
        source_review_action_id: TCA_ACTION_ID,
        statement_type: "balance sheet",
        line_item: "TOTAL CURRENT ASSETS",
        requested_period_end: "3/31/2026",
        requested_evidence_kind: "current_asset_detail",
        requested_period: "3/31/2026",
        clearing_target: "Total Current Assets of $3,097,345 as of 3/31/2026",
        tie_out_target_amount: 3_097_344.96,
        missing_amount: 2_898_652.37,
        requested_documents: ["Detailed current-asset schedule", "AR aging"],
        acceptable_documents: ["3/31/2026 AR aging or AR detail", "3/31/2026 detailed current asset schedule"],
        unacceptable_documents: ["AR aging from a different date with no reconciliation"],
        banker_internal_note: "REQUEST_SOURCE_DETAIL on YTD 2026 ... (internal)",
        tags: ["classic_spread", "source_detail", "balance_sheet", "current_assets"],
        generated_by: "sourceDetailRequestBuilder",
      },
    ],
    ...over,
  };
}

const activeTcaAction: SpreadRequestActionStatus = {
  id: TCA_ACTION_ID,
  finding_key: TCA_FINDING,
  status: "borrower_detail_requested",
};

describe("buildBorrowerSpreadRequestTiles — YTD 2026 Total Current Assets", () => {
  it("renders the request as an upload tile with current_asset_detail + structured copy", () => {
    const tiles = buildBorrowerSpreadRequestTiles({ drafts: [tcaDraft()], actions: [activeTcaAction] });
    assert.equal(tiles.length, 1);
    const t = tiles[0];
    assert.equal(t.requestedEvidenceKind, "current_asset_detail");
    assert.equal(t.requestedPeriod, "3/31/2026");
    assert.equal(t.clearingTarget, "Total Current Assets of $3,097,345 as of 3/31/2026");
    assert.equal(t.statementType, "balance sheet");
    assert.equal(t.lineItem, "TOTAL CURRENT ASSETS");
    assert.ok(t.acceptableDocuments.length > 0);
    assert.equal(t.hasUploadContext, true);
    // banker-internal copy is never surfaced
    assert.ok(!JSON.stringify(t).includes("banker_internal_note"));
    assert.ok(!t.description.includes("internal"));
  });

  it("forwards spreadReviewActionId / spreadFindingKey / draftBorrowerRequestId / requestedEvidenceKind", () => {
    const [t] = buildBorrowerSpreadRequestTiles({ drafts: [tcaDraft()], actions: [activeTcaAction] });
    assert.equal(t.spreadReviewActionId, TCA_ACTION_ID);
    assert.equal(t.spreadFindingKey, TCA_FINDING);
    assert.equal(t.draftBorrowerRequestId, "draft-tca");
    assert.equal(t.requestedEvidenceKind, "current_asset_detail");
  });

  it("an upload carrying that linkage classifies as LINKED evidence (not a heuristic candidate)", () => {
    const [t] = buildBorrowerSpreadRequestTiles({ drafts: [tcaDraft()], actions: [activeTcaAction] });
    // Simulate the doc deal_documents.metadata round-trip the commit route writes from the tile linkage.
    const action: EvidenceReviewAction = {
      id: TCA_ACTION_ID, findingKey: TCA_FINDING, actionType: "REQUEST_SOURCE_DETAIL",
      issueType: "missing_implied_component", statement: "balance_sheet", periodLabel: "YTD 2026",
      rowLabel: "TOTAL CURRENT ASSETS", status: "borrower_detail_requested",
      sourceValue: 198_692.59, recommendedValue: 2_898_652.37, diffValue: 2_898_652.37,
      periodEndDate: "3/31/2026", periodIsInterim: true,
    };
    const uploaded: EvidenceCandidateDoc = {
      id: "doc-ar", filename: "AR_Aging_3-31-2026.pdf", canonicalType: "AR_AGING", checklistKey: null,
      documentLabel: null, periodEnd: "2026-03-31", taxYear: 2026, extractionStatus: "extracted",
      isActive: true,
      linkedReviewActionId: t.spreadReviewActionId,
      linkedFindingKey: t.spreadFindingKey,
      linkedDraftRequestId: t.draftBorrowerRequestId,
      requestedEvidenceKind: t.requestedEvidenceKind,
    };
    const res = linkEvidenceUploads({ action, documents: [uploaded], draftRequests: [] });
    assert.deepEqual(res.linkedDocIds, ["doc-ar"]);
    assert.equal(res.candidateDocuments.length, 0);
    assert.equal(res.linkageConfidence, "explicit");
  });
});

describe("honest lifecycle — tiles disappear when the action is no longer active", () => {
  it("a closed (system-pruned) action does not appear as an active upload tile", () => {
    const tiles = buildBorrowerSpreadRequestTiles({
      drafts: [tcaDraft()],
      actions: [{ ...activeTcaAction, status: "closed" }],
    });
    assert.equal(tiles.length, 0);
  });

  it("a banker-settled action (source_verified) does not render a tile", () => {
    const tiles = buildBorrowerSpreadRequestTiles({
      drafts: [tcaDraft()],
      actions: [{ ...activeTcaAction, status: "source_verified" }],
    });
    assert.equal(tiles.length, 0);
  });

  it("no matching review action at all ⇒ no tile (cannot confirm still-unresolved)", () => {
    const tiles = buildBorrowerSpreadRequestTiles({ drafts: [tcaDraft()], actions: [] });
    assert.equal(tiles.length, 0);
  });

  it("matches by finding_key when the draft has no review-action id", () => {
    const draft = tcaDraft();
    (draft.evidence as any[])[0].source_review_action_id = null;
    const tiles = buildBorrowerSpreadRequestTiles({ drafts: [draft], actions: [activeTcaAction] });
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0].spreadReviewActionId, null);
    assert.equal(tiles[0].spreadFindingKey, TCA_FINDING);
  });

  it("an inactive draft status (rejected) does not render even with an active action", () => {
    const tiles = buildBorrowerSpreadRequestTiles({
      drafts: [tcaDraft({ status: "rejected" })],
      actions: [activeTcaAction],
    });
    assert.equal(tiles.length, 0);
  });
});

describe("preserves unrelated behavior + fallback rendering", () => {
  it("a non-spread borrower draft is never projected into a tile", () => {
    const unrelated: SpreadRequestDraftRow = {
      id: "draft-generic", status: "sent",
      draft_subject: "Please upload your driver's license",
      draft_message: "We need a copy of your ID.",
      evidence: [{ source: "manual_banker_request", note: "ID" }],
    };
    assert.equal(isSpreadSourceDetailDraft(unrelated), false);
    const tiles = buildBorrowerSpreadRequestTiles({ drafts: [unrelated], actions: [activeTcaAction] });
    assert.equal(tiles.length, 0);
  });

  it("a request lacking structured uploadContext is informational (hasUploadContext=false) but still forwards finding/action linkage", () => {
    const draft = tcaDraft();
    const ev = (draft.evidence as any[])[0];
    delete ev.requested_evidence_kind;
    delete ev.requested_period;
    delete ev.clearing_target;
    const [t] = buildBorrowerSpreadRequestTiles({ drafts: [draft], actions: [activeTcaAction] });
    assert.equal(t.hasUploadContext, false);
    assert.equal(t.requestedEvidenceKind, null);
    // still answerable as linked evidence via action id / finding key
    assert.equal(t.spreadReviewActionId, TCA_ACTION_ID);
    assert.equal(t.spreadFindingKey, TCA_FINDING);
  });

  it("a 2022 Schedule L VERIFY request renders only while its own action is active (independent of the TCA one)", () => {
    const slFinding = "2022|balance_sheet|total_liabilities_and_net_worth|unreconciled_total";
    const slDraft: SpreadRequestDraftRow = {
      id: "draft-sl", status: "pending_approval",
      draft_subject: "Upload source detail for 2022 balance sheet liabilities and net worth",
      draft_message: "Please upload the 2022 Schedule L.",
      evidence: [{
        source: "classic_spread_source_detail",
        source_finding_key: slFinding, source_review_action_id: "ra-sl-2022",
        statement_type: "balance sheet", line_item: "TOTAL LIABILITIES & NET WORTH",
        requested_evidence_kind: "schedule_l_detail", requested_period: "2022",
        clearing_target: "Total Liabilities + Net Worth reconciling to Total Assets as of 2022",
        acceptable_documents: ["2022 Schedule L"], unacceptable_documents: [],
      }],
    };
    // Only the TCA action is active; the 2022 SL action is closed ⇒ only the TCA tile renders.
    const tiles = buildBorrowerSpreadRequestTiles({
      drafts: [tcaDraft(), slDraft],
      actions: [activeTcaAction, { id: "ra-sl-2022", finding_key: slFinding, status: "closed" }],
    });
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0].draftBorrowerRequestId, "draft-tca");
  });
});
