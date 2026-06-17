import "server-only";

/**
 * SPEC-SPREAD-SOURCE-EVIDENCE-CLEARING-WORKFLOW-1 — server enrichment that attaches the source-evidence
 * lifecycle to each ACTIVE source-detail / verify review action, for the Review Actions panel.
 *
 * Reads the deal's existing `deal_documents` + `draft_borrower_requests` (no new tables/routes) and
 * delegates all logic to the pure `buildSourceEvidenceStatus`. Non-fatal: returns the rows unchanged
 * if the candidate fetch fails. `client` is injectable for tests.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isActiveReviewActionStatus } from "./reviewActionStatus";
import {
  buildSourceEvidenceStatus,
  type EvidenceCandidateDoc,
  type EvidenceDraftRequest,
} from "./sourceEvidenceStatus";

/** Normalize a raw deal_documents row to the pure evidence model's candidate-doc shape. */
export function normalizeEvidenceDoc(d: any): EvidenceCandidateDoc {
  const quality = (d.extraction_quality_status ?? "").toString().toLowerCase();
  const status = (d.status ?? "").toString().toLowerCase();
  const extractionStatus: EvidenceCandidateDoc["extractionStatus"] =
    quality === "failed"
      ? "failed"
      : d.finalized_at || d.canonical_type || ["ok", "complete", "passed", "extracted"].includes(quality)
        ? "extracted"
        : ["pending", "processing", "extracting", "classified_pending_review"].includes(status)
          ? "pending"
          : "unknown";
  return {
    id: d.id,
    filename: d.original_filename ?? d.display_name ?? "",
    canonicalType: d.canonical_type ?? d.document_type ?? d.gatekeeper_doc_type ?? null,
    checklistKey: d.checklist_key ?? null,
    documentLabel: d.document_label ?? null,
    periodEnd: d.ai_period_end ?? null,
    taxYear: d.ai_tax_year ?? d.gatekeeper_tax_year ?? d.doc_year ?? null,
    extractionStatus,
    isActive: d.is_active !== false,
  };
}

/** Pull source_finding_key / source_review_action_id out of a draft_borrower_requests.evidence jsonb. */
export function normalizeEvidenceDraft(d: any): EvidenceDraftRequest {
  const ev = Array.isArray(d.evidence) ? d.evidence : d.evidence != null ? [d.evidence] : [];
  const linked = ev.find((e: any) => e && (e.source_finding_key || e.source_review_action_id)) ?? {};
  return {
    id: d.id,
    status: d.status ?? "",
    sourceFindingKey: linked.source_finding_key ?? null,
    sourceReviewActionId: linked.source_review_action_id ?? null,
  };
}

/** True for rows whose blocker is a source-detail / source-line finding (always get an evidence strip). */
export function isSourceEvidenceRow(r: any): boolean {
  return r?.action_type === "REQUEST_SOURCE_DETAIL" || r?.action_type === "VERIFY_SOURCE_LINE";
}

function toEvidenceAction(r: any) {
  const fj = (r.finding_json ?? {}) as { periodEndDate?: string | null; periodIsInterim?: boolean };
  return {
    id: r.id, findingKey: r.finding_key, actionType: r.action_type, issueType: r.issue_type,
    statement: r.statement, periodLabel: r.period_label, rowLabel: r.row_label, status: r.status,
    sourceValue: r.source_value, recommendedValue: r.recommended_value, diffValue: r.diff_value,
    periodEndDate: fj.periodEndDate ?? null, periodIsInterim: fj.periodIsInterim,
  };
}

/**
 * Layered enrichment — evidence is MANDATORY for every active source row:
 *   1. build the base lifecycle from the review action alone (no DB) — the guaranteed fallback;
 *   2. try to load candidate documents; on failure keep the fallback (uploadStatus/extraction = unknown);
 *   3. try to load borrower draft requests; on failure rely on the action status for request state.
 * Never returns an active source row without `evidence`. Non-source / settled rows are untouched.
 * `client` is injectable for tests.
 */
export async function attachSourceEvidence(rows: any[], dealId: string, bankId: string, client?: any): Promise<any[]> {
  const sb = (() => {
    try { return client ?? supabaseAdmin(); } catch { return null; }
  })();

  // (2) candidate documents — independent failure does not drop the strip.
  let documents: ReturnType<typeof normalizeEvidenceDoc>[] = [];
  let documentsUnavailable = true;
  if (sb) {
    try {
      const { data, error } = await sb
        .from("deal_documents")
        .select("id, original_filename, display_name, canonical_type, document_type, gatekeeper_doc_type, checklist_key, document_label, ai_period_end, ai_tax_year, gatekeeper_tax_year, doc_year, finalized_at, extraction_quality_status, status, is_active")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId);
      if (!error) {
        documents = ((data ?? []) as any[]).map(normalizeEvidenceDoc);
        documentsUnavailable = false;
      } else {
        console.warn("[classic-spread/review-actions] document enrichment query error (non-fatal):", error.message);
      }
    } catch (e) {
      console.warn("[classic-spread/review-actions] document enrichment failed (non-fatal):", (e as any)?.message);
    }
  }

  // (3) borrower draft requests — independent failure just falls back to the action status.
  let draftRequests: ReturnType<typeof normalizeEvidenceDraft>[] = [];
  if (sb) {
    try {
      const { data, error } = await sb
        .from("draft_borrower_requests")
        .select("id, status, evidence")
        .eq("deal_id", dealId);
      if (!error) draftRequests = ((data ?? []) as any[]).map(normalizeEvidenceDraft);
      else console.warn("[classic-spread/review-actions] draft-request enrichment query error (non-fatal):", error.message);
    } catch (e) {
      console.warn("[classic-spread/review-actions] draft-request enrichment failed (non-fatal):", (e as any)?.message);
    }
  }

  return rows.map((r) => {
    if (!isSourceEvidenceRow(r) || !isActiveReviewActionStatus(r.status)) return r;
    try {
      const evidence = buildSourceEvidenceStatus({
        action: toEvidenceAction(r),
        documents,
        draftRequests,
        documentsUnavailable,
      });
      return { ...r, evidence };
    } catch (e) {
      // Last-resort guarantee: never return an active source row without an evidence strip.
      console.warn("[classic-spread/review-actions] evidence build failed (non-fatal):", (e as any)?.message);
      try {
        const evidence = buildSourceEvidenceStatus({ action: toEvidenceAction(r), documents: [], draftRequests: [], documentsUnavailable: true });
        return { ...r, evidence };
      } catch {
        return r;
      }
    }
  });
}
