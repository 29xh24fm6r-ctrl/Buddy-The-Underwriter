/**
 * SPEC-BORROWER-EVIDENCE-UPLOAD-TO-BLOCKER-CLEARING-1 — pure upload→action linker.
 *
 * Proves the linkage priority ladder: explicit review-action id > finding_key > draft-request id >
 * heuristic. Only explicit/request/finding-key matches are LINKED evidence; heuristic docs are
 * candidates and never fulfill the request.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { linkEvidenceUploads, documentLinkType } from "../evidenceUploadLinker";
import type { EvidenceCandidateDoc, EvidenceReviewAction, EvidenceDraftRequest } from "../sourceEvidenceStatus";

const action: EvidenceReviewAction = {
  id: "ra-tca", findingKey: "ytd_2026|balance_sheet|total_current_assets|missing_implied_component",
  actionType: "REQUEST_SOURCE_DETAIL", issueType: "missing_implied_component", statement: "balance_sheet",
  periodLabel: "YTD 2026", rowLabel: "TOTAL CURRENT ASSETS", status: "borrower_detail_requested",
  sourceValue: 198_692.59, recommendedValue: 2_898_652.37, diffValue: 2_898_652.37,
  periodEndDate: "3/31/2026", periodIsInterim: true,
};

const doc = (over: Partial<EvidenceCandidateDoc> & { id: string; filename: string }): EvidenceCandidateDoc => ({
  canonicalType: "AR_AGING", checklistKey: null, documentLabel: null, periodEnd: null, taxYear: 2026,
  extractionStatus: "extracted", isActive: true, ...over,
});

describe("documentLinkType", () => {
  it("explicit review_action_id wins", () => {
    assert.equal(documentLinkType(action, doc({ id: "d", filename: "x.pdf", linkedReviewActionId: "ra-tca" }), []), "explicit");
  });
  it("finding_key match", () => {
    assert.equal(documentLinkType(action, doc({ id: "d", filename: "x.pdf", linkedFindingKey: action.findingKey }), []), "finding_key_match");
  });
  it("draft request id mapping to the action", () => {
    const drafts: EvidenceDraftRequest[] = [{ id: "dr1", status: "sent", sourceFindingKey: null, sourceReviewActionId: "ra-tca" }];
    assert.equal(documentLinkType(action, doc({ id: "d", filename: "x.pdf", linkedDraftRequestId: "dr1" }), drafts), "request_match");
  });
  it("a draft request not tied to this action does not link", () => {
    const drafts: EvidenceDraftRequest[] = [{ id: "dr1", status: "sent", sourceFindingKey: "other", sourceReviewActionId: "other" }];
    assert.equal(documentLinkType(action, doc({ id: "d", filename: "x.pdf", linkedDraftRequestId: "dr1" }), drafts), null);
  });
  it("no metadata → not linked", () => {
    assert.equal(documentLinkType(action, doc({ id: "d", filename: "x.pdf" }), []), null);
  });
});

describe("linkEvidenceUploads", () => {
  it("a same-period heuristic candidate does NOT fulfill (no linkage metadata)", () => {
    const r = linkEvidenceUploads({ action, documents: [doc({ id: "ar", filename: "AR Aging 3-2026.pdf", periodEnd: "2026-03-31" })] });
    assert.equal(r.linkedEvidenceDocuments.length, 0);
    assert.equal(r.candidateDocuments.length, 1);
    assert.equal(r.linkageConfidence, "heuristic");
  });

  it("a wrong-period AR aging is a candidate, never linked, without metadata", () => {
    const r = linkEvidenceUploads({ action, documents: [doc({ id: "ar4", filename: "AR Aging 4-2026.pdf" })] });
    assert.equal(r.linkedEvidenceDocuments.length, 0);
    assert.equal(r.candidateDocuments.length, 1);
  });

  it("explicit linked doc wins over heuristic candidates (mixed)", () => {
    const r = linkEvidenceUploads({
      action,
      documents: [
        doc({ id: "heuristic", filename: "AR Aging 4-2026.pdf" }),
        doc({ id: "linked", filename: "AR Bridge March 2026.pdf", linkedReviewActionId: "ra-tca" }),
      ],
    });
    assert.deepEqual(r.linkedDocIds, ["linked"]);
    assert.equal(r.candidateDocuments.length, 1);
    assert.equal(r.candidateDocuments[0].id, "heuristic");
    assert.equal(r.linkageConfidence, "explicit");
  });

  it("no documents → none", () => {
    const r = linkEvidenceUploads({ action, documents: [] });
    assert.equal(r.linkageConfidence, "none");
    assert.equal(r.linkedEvidenceDocuments.length, 0);
  });
});
