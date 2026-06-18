/**
 * SPEC-BORROWER-EVIDENCE-UPLOAD-TO-BLOCKER-CLEARING-1 — pure upload→review-action linker.
 *
 * Decides which uploaded documents are LINKED EVIDENCE for a specific source-detail / verify review
 * action (the borrower's answer to the request) vs merely heuristic CANDIDATES. Only explicit /
 * draft-request / finding-key matches count as linked evidence — and only linked evidence may drive
 * "request fulfilled" or "regenerate required". Heuristic candidates are surfaced but never fulfill.
 *
 * Priority (strongest first):
 *   1. explicit         — deal_documents.metadata.spread_review_action_id === action.id
 *   2. finding_key      — deal_documents.metadata.spread_finding_key === action.findingKey
 *   3. request_match    — metadata.draft_borrower_request_id maps to a draft request tied to the action
 *   4. heuristic        — same deal + same evidence kind / period / statement-line class (candidate only)
 *
 * Pure: no DB, no math. Type-only import of the shared shapes (no runtime cycle).
 */

import type {
  EvidenceCandidateDoc,
  EvidenceDraftRequest,
  EvidenceReviewAction,
} from "./sourceEvidenceStatus";

export type LinkageConfidence = "explicit" | "finding_key_match" | "request_match" | "heuristic" | "none";

export type EvidenceLinkType = "explicit" | "finding_key_match" | "request_match" | null;

export type EvidenceLinkResult = {
  linkedEvidenceDocuments: EvidenceCandidateDoc[];
  candidateDocuments: EvidenceCandidateDoc[];
  linkedDocIds: string[];
  linkageConfidence: LinkageConfidence;
  linkageReason: string;
};

const STRENGTH: Record<Exclude<EvidenceLinkType, null>, number> = {
  explicit: 3,
  finding_key_match: 2,
  request_match: 1,
};

/** The strongest explicit linkage between an uploaded doc and a review action (or null = not linked). */
export function documentLinkType(
  action: EvidenceReviewAction,
  doc: EvidenceCandidateDoc,
  draftRequests: EvidenceDraftRequest[],
): EvidenceLinkType {
  if (doc.linkedReviewActionId && action.id && doc.linkedReviewActionId === action.id) return "explicit";
  if (doc.linkedFindingKey && action.findingKey && doc.linkedFindingKey === action.findingKey) return "finding_key_match";
  if (doc.linkedDraftRequestId) {
    const dr = draftRequests.find((d) => d.id === doc.linkedDraftRequestId);
    if (dr && (dr.sourceReviewActionId === action.id || dr.sourceFindingKey === action.findingKey)) return "request_match";
  }
  return null;
}

export function linkEvidenceUploads(args: {
  action: EvidenceReviewAction;
  documents: EvidenceCandidateDoc[];
  draftRequests?: EvidenceDraftRequest[];
}): EvidenceLinkResult {
  const draftRequests = args.draftRequests ?? [];
  const docs = (args.documents ?? []).filter((d) => d.isActive !== false);

  const linked: EvidenceCandidateDoc[] = [];
  const candidates: EvidenceCandidateDoc[] = [];
  let strongest: EvidenceLinkType = null;
  const reasons: string[] = [];

  for (const doc of docs) {
    const t = documentLinkType(args.action, doc, draftRequests);
    if (t) {
      linked.push(doc);
      if (!strongest || STRENGTH[t] > STRENGTH[strongest]) strongest = t;
      reasons.push(`${doc.filename}: ${t}`);
    } else {
      candidates.push(doc);
    }
  }

  const linkageConfidence: LinkageConfidence = strongest ?? (candidates.length > 0 ? "heuristic" : "none");
  const linkageReason =
    linked.length > 0
      ? `Linked by ${reasons.join("; ")}.`
      : candidates.length > 0
        ? "No explicit linkage — heuristic candidates only (do not fulfill the request)."
        : "No candidate documents found for this request.";

  return {
    linkedEvidenceDocuments: linked,
    candidateDocuments: candidates,
    linkedDocIds: linked.map((d) => d.id),
    linkageConfidence,
    linkageReason,
  };
}
