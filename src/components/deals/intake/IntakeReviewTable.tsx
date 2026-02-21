"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { CONFIDENCE_THRESHOLDS } from "@/lib/classification/calibrateConfidence";
import {
  MAX_PROCESSING_WINDOW_MS,
  POLL_INITIAL_MS,
  POLL_BACKOFF_MS,
  POLL_MAX_MS,
} from "@/lib/intake/constants";

// ── Types ──────────────────────────────────────────────────────────────

type IntakeDoc = {
  id: string;
  original_filename: string | null;
  canonical_type: string | null;
  document_type: string | null;
  checklist_key: string | null;
  doc_year: number | null;
  match_source: string | null;
  ai_doc_type: string | null;
  ai_confidence: number | null;
  classification_tier: string | null;
  gatekeeper_doc_type: string | null;
  gatekeeper_confidence: number | null;
  gatekeeper_needs_review: boolean | null;
  intake_status: string | null;
  intake_confirmed_at: string | null;
  intake_confirmed_by: string | null;
  intake_locked_at: string | null;
  created_at: string | null;
};

type ReviewData = {
  ok: boolean;
  intake_phase: string;
  feature_enabled: boolean;
  documents: IntakeDoc[];
};

type ConfBand = "LOW" | "MEDIUM" | "HIGH";
type Filter = "all" | "LOW" | "MEDIUM" | "pending";

// ── Helpers ────────────────────────────────────────────────────────────

/** Derive confidence band using shared calibration thresholds (single source of truth). */
function resolveConfBand(c: number | null | undefined): ConfBand {
  if (c != null && c >= CONFIDENCE_THRESHOLDS.HIGH) return "HIGH";
  if (c != null && c >= CONFIDENCE_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

const STATUS_LABELS: Record<string, string> = {
  UPLOADED: "Uploaded",
  CLASSIFIED_PENDING_REVIEW: "Pending Review",
  AUTO_CONFIRMED: "Auto-Confirmed",
  USER_CONFIRMED: "Confirmed",
  LOCKED_FOR_PROCESSING: "Locked",
};

const DOC_TYPE_OPTIONS = [
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "RENT_ROLL",
  "PERSONAL_FINANCIAL_STATEMENT",
  "PERSONAL_INCOME",
  "SCHEDULE_K1",
  "BANK_STATEMENT",
  "LEASE",
  "INSURANCE",
  "APPRAISAL",
  "OPERATING_AGREEMENT",
  "ARTICLES",
  "W2",
  "1099",
  "OTHER",
];

// ── Component ──────────────────────────────────────────────────────────

export function IntakeReviewTable({
  dealId,
  onNeedsReview,
  onSubmitted,
}: {
  dealId: string;
  onNeedsReview?: () => void;
  onSubmitted?: () => void;
}) {
  const [data, setData] = useState<ReviewData | null>(null);
  const needsReviewFired = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [submitting, setSubmitting] = useState(false);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [editingDoc, setEditingDoc] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    canonical_type?: string;
    tax_year?: number;
  }>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/intake/review`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to load intake review data");
        return;
      }
      setData(json);
      setError(null);
      // Fire onNeedsReview once when phase reaches CLASSIFIED_PENDING_CONFIRMATION
      if (
        json?.intake_phase === "CLASSIFIED_PENDING_CONFIRMATION" &&
        !needsReviewFired.current
      ) {
        needsReviewFired.current = true;
        onNeedsReview?.();
      }
    } catch (err: any) {
      setError(err?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [dealId, onNeedsReview]);

  // Part 6: Exponential backoff polling — starts fast during processing,
  // backs off to reduce server load, stops after completion.
  const pollTickRef = useRef(0);

  useEffect(() => {
    void refresh();

    function getPollInterval(): number {
      if (data?.intake_phase !== "CONFIRMED_READY_FOR_PROCESSING") {
        pollTickRef.current = 0;
        return 8000; // normal idle polling
      }
      // Backoff: 3s → 5s → 10s (capped)
      const tick = pollTickRef.current;
      if (tick < 3) return POLL_INITIAL_MS;
      if (tick < 8) return POLL_BACKOFF_MS;
      return POLL_MAX_MS;
    }

    const interval = setInterval(() => {
      pollTickRef.current += 1;
      void refresh();
    }, getPollInterval());

    return () => clearInterval(interval);
  }, [refresh, data?.intake_phase]);

  const filteredDocs = useMemo(() => {
    if (!data?.documents) return [];
    if (filter === "all") return data.documents;
    return data.documents.filter((d) => {
      const band = resolveConfBand(d.ai_confidence);
      if (filter === "LOW") return band === "LOW";
      if (filter === "MEDIUM") return band === "MEDIUM";
      if (filter === "pending")
        return (
          d.intake_status === "UPLOADED" ||
          d.intake_status === "CLASSIFIED_PENDING_REVIEW"
        );
      return true;
    });
  }, [data?.documents, filter]);

  const counts = useMemo(() => {
    const docs = data?.documents ?? [];
    return {
      total: docs.length,
      low: docs.filter((d) => resolveConfBand(d.ai_confidence) === "LOW").length,
      medium: docs.filter((d) => resolveConfBand(d.ai_confidence) === "MEDIUM").length,
      pending: docs.filter(
        (d) =>
          d.intake_status === "UPLOADED" ||
          d.intake_status === "CLASSIFIED_PENDING_REVIEW",
      ).length,
    };
  }, [data?.documents]);

  const canSubmit = useMemo(() => {
    if (!data?.documents?.length) return false;
    return !data.documents.some(
      (d) =>
        d.intake_status === "UPLOADED" ||
        d.intake_status === "CLASSIFIED_PENDING_REVIEW",
    );
  }, [data?.documents]);

  const isProcessing =
    data?.intake_phase === "CONFIRMED_READY_FOR_PROCESSING";
  const isComplete =
    data?.intake_phase === "PROCESSING_COMPLETE" ||
    data?.intake_phase === "PROCESSING_COMPLETE_WITH_ERRORS";

  // Part 1+2: Client-side timeout guard — UI-derived stuck state.
  // Computed, not persisted. If processing exceeds MAX_PROCESSING_WINDOW_MS,
  // show amber "taking longer than expected" state instead of spinner.
  const isStuck =
    isProcessing &&
    processingStartedAt !== null &&
    elapsed * 1000 >= MAX_PROCESSING_WINDOW_MS;

  // Track elapsed time during processing
  useEffect(() => {
    if (isProcessing && processingStartedAt === null) {
      setProcessingStartedAt(Date.now());
    }
    if (isComplete) {
      setProcessingStartedAt(null);
    }
  }, [isProcessing, isComplete, processingStartedAt]);

  useEffect(() => {
    if (!isProcessing || processingStartedAt === null) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - processingStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isProcessing, processingStartedAt]);

  // ── Actions ────────────────────────────────────────────────────────

  async function confirmDoc(docId: string, patch?: { canonical_type?: string; tax_year?: number }) {
    try {
      const body: Record<string, unknown> = {};
      if (patch?.canonical_type) body.canonical_type = patch.canonical_type;
      if (patch?.tax_year) body.tax_year = patch.tax_year;

      const res = await fetch(
        `/api/deals/${dealId}/intake/documents/${docId}/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to confirm document");
        return;
      }
      setEditingDoc(null);
      setEditValues({});
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Confirm failed");
    }
  }

  async function submitToProcessing() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/intake/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        const errMsg =
          json?.error === "quality_gate_failed"
            ? "Some document(s) failed automated quality checks (e.g., unreadable scan or insufficient OCR text). Please re-upload a clearer copy."
            : json?.error === "pending_documents_exist"
            ? `${json.pending_count ?? "Some"} document(s) still need confirmation before processing.`
            : json?.error ?? "Failed to submit";
        setError(errMsg);
        return;
      }
      // Start the processing timer immediately for instant feedback
      setProcessingStartedAt(Date.now());
      setElapsed(0);
      await refresh();
      // After successful submit, notify parent that processing is enqueued
      onSubmitted?.();
    } catch (err: any) {
      setError(err?.message ?? "Submit failed");
      setProcessingStartedAt(null);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-white/40 text-sm p-4">
        Loading intake review...
      </div>
    );
  }

  if (!data?.feature_enabled) {
    return null;
  }

  if (isProcessing) {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    // Part 1: Stuck state — amber UI when elapsed > MAX_PROCESSING_WINDOW_MS
    if (isStuck) {
      return (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-400 text-[20px]">
              schedule
            </span>
            <div>
              <div className="text-amber-400 text-sm font-medium">
                Processing is taking longer than expected
              </div>
              <div className="text-white/40 text-xs mt-0.5">
                {timeStr} elapsed — Buddy is still working. If this persists, you may
                re-submit or contact support.
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Part 9: UX copy — institutional framing
    return (
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
        <div className="flex items-center gap-3">
          <div className="relative h-5 w-5 flex-shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-blue-500/30" />
            <div className="absolute inset-0 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          </div>
          <div>
            <div className="text-blue-400 text-sm font-medium">
              Buddy is processing your documents securely
            </div>
            <div className="text-white/40 text-xs mt-0.5">
              Matching, extracting, and computing spreads — {timeStr} elapsed
            </div>
          </div>
        </div>
        <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full bg-blue-500/40 rounded-full animate-pulse" style={{ width: "100%" }} />
        </div>
      </div>
    );
  }

  if (isComplete) {
    const hasErrors = data?.intake_phase === "PROCESSING_COMPLETE_WITH_ERRORS";
    return (
      <div className={cn(
        "rounded-xl border p-4",
        hasErrors
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-emerald-500/20 bg-emerald-500/5",
      )}>
        <div className={cn(
          "flex items-center gap-2 text-sm font-medium",
          hasErrors ? "text-amber-400" : "text-emerald-400",
        )}>
          <span className="material-symbols-outlined text-[16px]">
            {hasErrors ? "warning" : "check_circle"}
          </span>
          {hasErrors
            ? "Processing complete — some documents had issues"
            : "Intake confirmed and processing complete"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
          Intake Review
        </h3>
        <div className="flex items-center gap-2">
          {counts.low > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400">
              {counts.low} low confidence
            </span>
          )}
          {counts.medium > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              {counts.medium} moderate
            </span>
          )}
          {counts.pending > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
              {counts.pending} pending
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-1">
        {(["all", "LOW", "MEDIUM", "pending"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md transition-colors",
              filter === f
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/60 hover:bg-white/5",
            )}
          >
            {f === "all" ? `All (${counts.total})` :
             f === "LOW" ? `Low (${counts.low})` :
             f === "MEDIUM" ? `Medium (${counts.medium})` :
             `Pending (${counts.pending})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/40 border-b border-white/10">
              <th className="text-left py-2 px-2 font-medium">Filename</th>
              <th className="text-left py-2 px-2 font-medium">Type</th>
              <th className="text-left py-2 px-2 font-medium">Year</th>
              <th className="text-center py-2 px-2 font-medium">Confidence</th>
              <th className="text-center py-2 px-2 font-medium">Status</th>
              <th className="text-right py-2 px-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocs.map((doc) => {
              const isEditing = editingDoc === doc.id;

              return (
                <tr
                  key={doc.id}
                  className="border-b border-white/5 hover:bg-white/[0.02]"
                >
                  <td className="py-2 px-2 text-white/70 max-w-[200px] truncate">
                    {doc.original_filename ?? "—"}
                  </td>
                  <td className="py-2 px-2">
                    {isEditing ? (
                      <select
                        value={editValues.canonical_type ?? doc.canonical_type ?? ""}
                        onChange={(e) =>
                          setEditValues((prev) => ({
                            ...prev,
                            canonical_type: e.target.value,
                          }))
                        }
                        className="bg-gray-900 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white w-full"
                      >
                        <option value="" className="bg-gray-900 text-white">Select type...</option>
                        {DOC_TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t} className="bg-gray-900 text-white">
                            {t.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-white/60">
                        {doc.canonical_type?.replace(/_/g, " ") ??
                          doc.document_type?.replace(/_/g, " ") ??
                          "Unclassified"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    {isEditing ? (
                      <input
                        type="number"
                        min={1990}
                        max={2100}
                        value={editValues.tax_year ?? doc.doc_year ?? ""}
                        onChange={(e) =>
                          setEditValues((prev) => ({
                            ...prev,
                            tax_year: e.target.value
                              ? parseInt(e.target.value, 10)
                              : undefined,
                          }))
                        }
                        className="bg-gray-900 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white w-16"
                      />
                    ) : (
                      <span className="text-white/60">
                        {doc.doc_year ?? "—"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <ConfidenceBadge
                      confidence={doc.ai_confidence}
                      confirmed={doc.match_source === "manual"}
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className="text-white/50">
                      {STATUS_LABELS[doc.intake_status ?? ""] ?? doc.intake_status ?? "—"}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right">
                    {isEditing ? (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => {
                            setEditingDoc(null);
                            setEditValues({});
                          }}
                          className="text-white/40 hover:text-white/60 px-1.5 py-0.5 rounded text-[10px]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => void confirmDoc(doc.id, editValues)}
                          className="bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 px-2 py-0.5 rounded text-[10px] font-medium"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => {
                            setEditingDoc(doc.id);
                            setEditValues({
                              canonical_type: doc.canonical_type ?? undefined,
                              tax_year: doc.doc_year ?? undefined,
                            });
                          }}
                          className="text-white/40 hover:text-white/60 px-1.5 py-0.5 rounded text-[10px]"
                        >
                          Edit
                        </button>
                        {(doc.intake_status === "CLASSIFIED_PENDING_REVIEW" ||
                          doc.intake_status === "UPLOADED") && (
                          <button
                            onClick={() => void confirmDoc(doc.id)}
                            className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-medium"
                          >
                            Confirm
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredDocs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-white/30">
                  No documents match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Submit CTA */}
      <div className="flex justify-end pt-2">
        <button
          onClick={() => void submitToProcessing()}
          disabled={!canSubmit || submitting}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            canSubmit && !submitting
              ? "bg-blue-600 text-white hover:bg-blue-500"
              : "bg-white/5 text-white/20 cursor-not-allowed",
          )}
        >
          {submitting ? "Processing..." : "Submit to Processing"}
        </button>
      </div>
    </div>
  );
}
