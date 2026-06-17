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

export async function attachSourceEvidence(
  rows: any[],
  dealId: string,
  bankId: string,
  client?: any,
): Promise<any[]> {
  try {
    const sb = client ?? supabaseAdmin();
    const { data: docRows } = await sb
      .from("deal_documents")
      .select("id, original_filename, display_name, canonical_type, document_type, gatekeeper_doc_type, checklist_key, document_label, ai_period_end, ai_tax_year, gatekeeper_tax_year, doc_year, finalized_at, extraction_quality_status, status, is_active")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId);
    const { data: draftRows } = await sb
      .from("draft_borrower_requests")
      .select("id, status, evidence")
      .eq("deal_id", dealId);

    const documents = ((docRows ?? []) as any[]).map(normalizeEvidenceDoc);
    const draftRequests = ((draftRows ?? []) as any[]).map(normalizeEvidenceDraft);

    return rows.map((r) => {
      const isSource = r.action_type === "REQUEST_SOURCE_DETAIL" || r.action_type === "VERIFY_SOURCE_LINE";
      if (!isSource || !isActiveReviewActionStatus(r.status)) return r;
      const fj = (r.finding_json ?? {}) as { periodEndDate?: string | null; periodIsInterim?: boolean };
      const evidence = buildSourceEvidenceStatus({
        action: {
          id: r.id, findingKey: r.finding_key, actionType: r.action_type, issueType: r.issue_type,
          statement: r.statement, periodLabel: r.period_label, rowLabel: r.row_label, status: r.status,
          sourceValue: r.source_value, recommendedValue: r.recommended_value, diffValue: r.diff_value,
          periodEndDate: fj.periodEndDate ?? null, periodIsInterim: fj.periodIsInterim,
        },
        documents,
        draftRequests,
      });
      return { ...r, evidence };
    });
  } catch (e) {
    console.warn("[classic-spread/review-actions] evidence enrichment failed (non-fatal):", (e as any)?.message);
    return rows;
  }
}
