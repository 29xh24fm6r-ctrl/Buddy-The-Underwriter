/**
 * SPEC-SPREAD-SOURCE-EVIDENCE-CLEARING-WORKFLOW-1 — pure source-evidence lifecycle model.
 *
 * Given a classic-spread review action (a source-detail / verify blocker), the deal's candidate
 * documents, and any linked borrower draft requests, this computes an honest evidence-clearing
 * lifecycle for the Review Actions panel:
 *
 *   Needed -> Requested -> Uploaded -> Extracted -> Cleared / Still blocking (and WHY).
 *
 * Lifecycle truth (never shortcut):
 *   - request created  != cleared
 *   - upload completed != cleared
 *   - extraction done  != cleared
 *   - a blocker clears ONLY when the latest regenerate/sync audit no longer emits the finding (the
 *     review-action row is then closed/settled by reviewActionsRepo prune).
 *
 * Pure: no DB, no canonical VM, no source-line inference, no spread/cert/BBC math. The caller (the
 * GET /review-actions route) fetches deal_documents + draft_borrower_requests and passes normalized
 * shapes in.
 */

import { isActiveReviewActionStatus } from "./reviewActionStatus";

// ── inputs ────────────────────────────────────────────────────────────────────────────────────
export type EvidenceCandidateDoc = {
  id: string;
  filename: string;
  /** canonical_type ?? document_type ?? gatekeeper_doc_type */
  canonicalType: string | null;
  checklistKey: string | null;
  documentLabel: string | null;
  /** ai_period_end ISO ("2026-03-31") when present; usually null for these tenants */
  periodEnd: string | null;
  /** ai_tax_year ?? gatekeeper_tax_year ?? doc_year */
  taxYear: number | null;
  extractionStatus: "extracted" | "pending" | "failed" | "unknown";
  isActive: boolean;
};

export type EvidenceDraftRequest = {
  id: string;
  status: string; // pending_approval | approved | sent | rejected
  sourceFindingKey: string | null;
  sourceReviewActionId: string | null;
};

export type EvidenceReviewAction = {
  id: string;
  findingKey: string;
  actionType: string; // REQUEST_SOURCE_DETAIL | VERIFY_SOURCE_LINE | ...
  issueType: string;
  statement: string; // balance_sheet | income_statement | cash_flow | ...
  periodLabel: string;
  rowLabel: string;
  status: string; // open | borrower_detail_requested | confirmed_resolved_value | ...
  sourceValue: number | null;
  recommendedValue: number | null;
  diffValue: number | null;
  /** from finding_json (set at sync time) */
  periodEndDate?: string | null;
  periodIsInterim?: boolean;
};

// ── output ────────────────────────────────────────────────────────────────────────────────────
export type EvidenceRequestStatus = "not_requested" | "requested" | "not_applicable";
export type EvidenceUploadStatus =
  | "no_candidate_uploaded"
  | "candidate_uploaded"
  | "candidate_uploaded_wrong_period"
  | "candidate_uploaded_needs_bridge"
  | "candidate_uploaded_extracted";
export type EvidenceExtractionStatus = "not_started" | "pending" | "extracted" | "failed" | "unknown";
export type EvidenceClearingStatus = "still_blocking" | "cleared_after_regenerate" | "needs_regenerate" | "unknown";
export type EvidenceTone = "blocker" | "warning" | "success" | "neutral";

export type EvidenceMatchingDocument = {
  id: string;
  filename: string;
  docType: string | null;
  periodLabel: string | null;
  periodMatch: "exact" | "same_year" | "other" | "unknown";
  role: "clearing" | "context";
  extractionStatus: EvidenceExtractionStatus;
  note: string | null;
};

export type SourceEvidenceStatus = {
  requiredEvidenceSummary: string;
  requestStatus: EvidenceRequestStatus;
  uploadStatus: EvidenceUploadStatus;
  extractionStatus: EvidenceExtractionStatus;
  clearingStatus: EvidenceClearingStatus;
  matchingDocuments: EvidenceMatchingDocument[];
  blockingReason: string | null;
  nextActionLabel: string;
  statusTone: EvidenceTone;
  requestWarning: string | null;
};

// ── period parsing / matching ───────────────────────────────────────────────────────────────────
type ParsedPeriod = { year: number | null; month: number | null };

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function parseIsoOrUs(s: string | null | undefined): ParsedPeriod {
  if (!s) return { year: null, month: null };
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return { year: +iso[1], month: +iso[2] };
  const us = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return { year: +us[3], month: +us[1] };
  const y = s.match(/\b(19|20)\d{2}\b/);
  return { year: y ? +y[0] : null, month: null };
}

function parseFromFilename(name: string): ParsedPeriod {
  const lower = (name ?? "").toLowerCase();
  let year: number | null = null;
  let month: number | null = null;
  // "4-2026" / "4/2026" (month-year)
  const my = lower.match(/\b(\d{1,2})[-/](\d{4})\b/);
  if (my) { month = +my[1]; year = +my[2]; }
  const y = lower.match(/\b(19|20)\d{2}\b/);
  if (y && year == null) year = +y[0];
  if (month == null) {
    for (const [k, v] of Object.entries(MONTHS)) {
      if (new RegExp(`\\b${k}\\b`).test(lower)) { month = v; break; }
    }
  }
  return { year, month };
}

/** A candidate's best period estimate: ai_period_end, else tax year (+ month from filename). */
function docPeriod(doc: EvidenceCandidateDoc): ParsedPeriod {
  const fromEnd = parseIsoOrUs(doc.periodEnd);
  if (fromEnd.year != null) return fromEnd;
  const fromName = parseFromFilename(doc.filename);
  const year = doc.taxYear ?? fromName.year;
  return { year, month: fromName.month };
}

/** The blocker's target period: the finding_json end date when present, else the period label. */
function targetPeriod(a: EvidenceReviewAction): ParsedPeriod {
  const fromEnd = parseIsoOrUs(a.periodEndDate ?? null);
  if (fromEnd.year != null) return fromEnd;
  return parseIsoOrUs(a.periodLabel);
}

function isAnnualTarget(a: EvidenceReviewAction): boolean {
  if (a.periodIsInterim === true) return false;
  if (a.periodIsInterim === false) return true;
  // No flag: a bare-year label ("2022") is annual; an interim label ("YTD 2026") is not.
  return /^\s*\d{4}\s*$/.test(a.periodLabel);
}

function periodMatch(a: EvidenceReviewAction, doc: EvidenceCandidateDoc): EvidenceMatchingDocument["periodMatch"] {
  const t = targetPeriod(a);
  const d = docPeriod(doc);
  if (t.year == null || d.year == null) return "unknown";
  if (d.year !== t.year) return "other";
  if (isAnnualTarget(a)) return "exact"; // same year is exact for an annual statement
  if (t.month != null && d.month != null) return t.month === d.month ? "exact" : "same_year";
  return "same_year";
}

// ── blocker classification + candidate roles ─────────────────────────────────────────────────────
type BlockerKind = "tca_ar" | "tlnw" | "bs_other" | "income" | "generic";

function classifyBlocker(a: EvidenceReviewAction): BlockerKind {
  const row = a.rowLabel ?? "";
  if (a.statement === "income_statement") return "income";
  if (a.statement === "balance_sheet") {
    if (/current asset|receivable|\bA\/?R\b/i.test(row) || a.issueType === "missing_implied_component") return "tca_ar";
    if (/liabilit|net worth|equity/i.test(row) || a.issueType === "unreconciled_total") return "tlnw";
    return "bs_other";
  }
  return "generic";
}

const norm = (s: string | null): string => (s ?? "").toUpperCase();

function isArDetailDoc(doc: EvidenceCandidateDoc): boolean {
  return (
    norm(doc.canonicalType) === "AR_AGING" ||
    /\bAR\b|RECEIVABLE|AGING|CURRENT ASSET/i.test(`${doc.checklistKey ?? ""} ${doc.documentLabel ?? ""} ${doc.filename}`)
  );
}

/** Whether a doc is a relevant candidate for the blocker, and whether it is "clearing/augmenting"
 * (provides the missing detail → an exact-period extracted one can clear after regenerate) vs
 * "context" (the already-consumed base statement that produced the finding). */
function classifyDoc(kind: BlockerKind, a: EvidenceReviewAction, doc: EvidenceCandidateDoc): { relevant: boolean; role: "clearing" | "context"; augmenting: boolean } {
  const ct = norm(doc.canonicalType);
  const annual = isAnnualTarget(a);
  switch (kind) {
    case "tca_ar": {
      if (isArDetailDoc(doc)) return { relevant: true, role: "clearing", augmenting: true };
      if (ct === "BALANCE_SHEET") return { relevant: true, role: "context", augmenting: false };
      if (annual && ct === "BUSINESS_TAX_RETURN") return { relevant: true, role: "context", augmenting: false };
      return { relevant: false, role: "context", augmenting: false };
    }
    case "tlnw":
    case "bs_other": {
      if (ct === "BALANCE_SHEET") return { relevant: true, role: "clearing", augmenting: false };
      if (annual && ct === "BUSINESS_TAX_RETURN") return { relevant: true, role: "clearing", augmenting: false };
      return { relevant: false, role: "context", augmenting: false };
    }
    case "income": {
      if (ct === "INCOME_STATEMENT") return { relevant: true, role: "clearing", augmenting: false };
      if (annual && ct === "BUSINESS_TAX_RETURN") return { relevant: true, role: "clearing", augmenting: false };
      return { relevant: false, role: "context", augmenting: false };
    }
    default:
      return { relevant: true, role: "context", augmenting: false };
  }
}

// ── formatting helpers ────────────────────────────────────────────────────────────────────────
const fmtUsd = (n: number | null | undefined): string | null =>
  n == null || !Number.isFinite(n) ? null : `$${Math.round(n).toLocaleString("en-US")}`;
const displayLineName = (row: string): string =>
  (row ?? "").trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function docPeriodLabel(doc: EvidenceCandidateDoc): string | null {
  if (doc.periodEnd) return doc.periodEnd;
  const d = docPeriod(doc);
  if (d.year == null) return null;
  return d.month != null ? `${d.month}/${d.year}` : `${d.year}`;
}

function requiredEvidence(kind: BlockerKind, a: EvidenceReviewAction): string {
  const periodRef = (a.periodEndDate && a.periodEndDate.trim()) || a.periodLabel;
  const lineName = displayLineName(a.rowLabel);
  if (kind === "tca_ar") {
    // missing_implied_component: reported TCA = present components + the implied gap.
    const tieOut = a.issueType === "missing_implied_component" && a.sourceValue != null && a.diffValue != null
      ? a.sourceValue + a.diffValue
      : a.recommendedValue;
    const tieFmt = fmtUsd(tieOut);
    return `${periodRef} current-asset detail or AR aging${tieFmt ? ` tying to Total Current Assets of ${tieFmt}` : ""}.`;
  }
  if (kind === "tlnw") {
    const taFmt = fmtUsd(a.recommendedValue);
    return `${periodRef} Schedule L source detail showing liability/equity lines needed to reconcile Total Assets${taFmt ? ` of ${taFmt}` : ""} to Liabilities + Net Worth.`;
  }
  if (kind === "income") return `${periodRef} income-statement detail or source schedule supporting ${lineName}.`;
  if (kind === "bs_other") return `${periodRef} schedule/detail supporting ${lineName}.`;
  return `Source documentation supporting ${lineName} for ${periodRef}.`;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
export function buildSourceEvidenceStatus(args: {
  action: EvidenceReviewAction;
  documents: EvidenceCandidateDoc[];
  draftRequests?: EvidenceDraftRequest[];
}): SourceEvidenceStatus {
  const { action } = args;
  const documents = (args.documents ?? []).filter((d) => d.isActive !== false);
  const draftRequests = args.draftRequests ?? [];

  const isSourceAction = action.actionType === "REQUEST_SOURCE_DETAIL" || action.actionType === "VERIFY_SOURCE_LINE";
  const kind = classifyBlocker(action);
  const periodRef = (action.periodEndDate && action.periodEndDate.trim()) || action.periodLabel;

  // ── matching documents ──
  const matching: EvidenceMatchingDocument[] = [];
  for (const doc of documents) {
    const c = classifyDoc(kind, action, doc);
    if (!c.relevant) continue;
    const match = periodMatch(action, doc);
    let note: string | null = null;
    if (c.augmenting && match === "same_year") note = `does not clear ${periodRef} without a reconciliation bridge`;
    else if (match === "other") note = "different period";
    else if (c.role === "context" && match === "exact") note = "already consumed source — lacks the missing detail";
    matching.push({
      id: doc.id, filename: doc.filename, docType: doc.canonicalType,
      periodLabel: docPeriodLabel(doc), periodMatch: match, role: c.role,
      extractionStatus: doc.extractionStatus, note,
    });
  }

  // ── request status ──
  let requestStatus: EvidenceRequestStatus = isSourceAction ? "not_requested" : "not_applicable";
  let requestWarning: string | null = null;
  const linkedDraft = draftRequests.find(
    (d) => ["pending_approval", "approved", "sent"].includes(d.status) &&
      (d.sourceFindingKey === action.findingKey || (action.id && d.sourceReviewActionId === action.id)),
  );
  if (isSourceAction) {
    if (linkedDraft) requestStatus = "requested";
    else if (action.status === "borrower_detail_requested") {
      requestStatus = "requested";
      requestWarning = "Request status says requested, but no linked borrower request was found.";
    }
  }

  // ── upload status (driven by the clearing/augmenting docs; context BS does not elevate it) ──
  const clearing = matching.filter((m) => m.role === "clearing");
  const augmenting = clearing.filter((m) => {
    const c = classifyDoc(kind, action, documents.find((d) => d.id === m.id)!);
    return c.augmenting;
  });
  const best = (arr: EvidenceMatchingDocument[], match: EvidenceMatchingDocument["periodMatch"]) =>
    arr.find((m) => m.periodMatch === match);

  let uploadStatus: EvidenceUploadStatus = "no_candidate_uploaded";
  // Augmenting (AR aging etc.) takes priority for the bridge/extracted signals.
  if (best(augmenting, "exact") && best(augmenting, "exact")!.extractionStatus === "extracted") uploadStatus = "candidate_uploaded_extracted";
  else if (best(augmenting, "exact")) uploadStatus = "candidate_uploaded";
  else if (best(augmenting, "same_year")) uploadStatus = "candidate_uploaded_needs_bridge";
  else if (best(clearing, "exact") && best(clearing, "exact")!.extractionStatus === "extracted") uploadStatus = "candidate_uploaded_extracted";
  else if (best(clearing, "exact")) uploadStatus = "candidate_uploaded";
  else if (clearing.some((m) => m.periodMatch === "same_year")) uploadStatus = "candidate_uploaded_needs_bridge";
  else if (augmenting.length > 0 || clearing.length > 0) uploadStatus = "candidate_uploaded_wrong_period";
  else if (matching.length > 0) uploadStatus = "candidate_uploaded"; // only context docs (already-consumed source)

  // ── extraction status (the best relevant clearing doc, else any matching doc) ──
  const extractionPool = (clearing.length > 0 ? clearing : matching);
  let extractionStatus: EvidenceExtractionStatus = "not_started";
  if (matching.length === 0) extractionStatus = "not_started";
  else if (extractionPool.some((m) => m.extractionStatus === "extracted")) extractionStatus = "extracted";
  else if (extractionPool.some((m) => m.extractionStatus === "pending")) extractionStatus = "pending";
  else if (extractionPool.some((m) => m.extractionStatus === "failed")) extractionStatus = "failed";
  else extractionStatus = "unknown";

  // ── clearing status (the authority — only a settled action means the finding is gone) ──
  let clearingStatus: EvidenceClearingStatus;
  if (!isActiveReviewActionStatus(action.status)) {
    clearingStatus = "cleared_after_regenerate";
  } else if (uploadStatus === "candidate_uploaded_extracted" && augmenting.length > 0) {
    // New augmenting detail (e.g. exact-period AR aging) is uploaded + extracted but the finding is
    // still active → a regenerate/sync should consume it and re-check.
    clearingStatus = "needs_regenerate";
  } else {
    clearingStatus = "still_blocking";
  }

  // ── blocking reason ──
  let blockingReason: string | null = null;
  if (clearingStatus === "cleared_after_regenerate") {
    blockingReason = null;
  } else if (clearingStatus === "needs_regenerate") {
    blockingReason = `Required ${periodRef} detail is uploaded and extracted — regenerate/sync the spread to consume it and re-check this finding.`;
  } else if (kind === "tca_ar") {
    const bridge = augmenting.find((m) => m.periodMatch === "same_year");
    blockingReason = bridge
      ? `The uploaded AR aging (${bridge.periodLabel ?? "different date"}) does not clear ${periodRef} balance-sheet TCA without a reconciliation bridge. No ${periodRef} AR/current-asset detail or bridge has been consumed in the latest audit.`
      : `No ${periodRef} AR/current-asset detail or bridge has been consumed in the latest audit.`;
  } else if (kind === "tlnw") {
    blockingReason = "Extracted Schedule L liability/equity side does not reconcile; missing source detail for liability/equity lines.";
  } else {
    blockingReason = `No ${periodRef} source detail for ${displayLineName(action.rowLabel)} has been consumed in the latest audit.`;
  }

  // ── next action ──
  let nextActionLabel: string;
  if (clearingStatus === "cleared_after_regenerate") nextActionLabel = "Cleared";
  else if (clearingStatus === "needs_regenerate") nextActionLabel = "Regenerate the spread to consume the uploaded detail";
  else if (uploadStatus === "candidate_uploaded_needs_bridge") nextActionLabel = `Provide ${periodRef} detail or a reconciliation bridge`;
  else if (requestStatus === "not_requested") nextActionLabel = "Request borrower detail";
  else if (requestStatus === "requested" && uploadStatus === "no_candidate_uploaded") nextActionLabel = "Awaiting borrower upload";
  else nextActionLabel = "Upload the missing source detail";

  const statusTone: EvidenceTone =
    clearingStatus === "cleared_after_regenerate" ? "success"
      : clearingStatus === "needs_regenerate" ? "warning"
        : !isSourceAction ? "neutral"
          : "blocker";

  return {
    requiredEvidenceSummary: requiredEvidence(kind, action),
    requestStatus,
    uploadStatus,
    extractionStatus,
    clearingStatus,
    matchingDocuments: matching,
    blockingReason,
    nextActionLabel,
    statusTone,
    requestWarning,
  };
}
