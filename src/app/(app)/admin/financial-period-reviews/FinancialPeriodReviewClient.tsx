"use client";

import { useCallback, useEffect, useState } from "react";

type ReviewRow = {
  id: string;
  deal_id: string;
  document_id: string;
  current_document_type: string;
  current_canonical_type: string;
  current_checklist_key: string | null;
  current_statement_period: string | null;
  review_reason: string;
  status: string;
  reviewer_decision: string | null;
  confirmed_statement_period: string | null;
  confirmed_checklist_key: string | null;
  reviewer_note: string | null;
  resolved_at: string | null;
  created_at: string;
  // Joined from deal_documents (may not be present)
  deal_documents?: {
    original_filename: string | null;
    display_name: string | null;
    canonical_type: string | null;
    doc_year: number | null;
  };
};

type SeedResult = {
  candidatesFound: number;
  alreadyOpen: number;
  seeded: number;
};

export default function FinancialPeriodReviewClient() {
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/financial-period-reviews?status=OPEN");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch");
      setReviews(json.reviews ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const seedReviews = async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch("/api/admin/financial-period-reviews", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to seed");
      setSeedResult(json);
      await fetchReviews();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSeeding(false);
    }
  };

  const resolveReview = async (reviewId: string, period: string) => {
    setResolving(reviewId);
    try {
      const res = await fetch(`/api/admin/financial-period-reviews/${reviewId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedStatementPeriod: period }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to resolve");
      await fetchReviews();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResolving(null);
    }
  };

  const markNotApplicable = async (reviewId: string) => {
    setResolving(reviewId);
    try {
      const res = await fetch(`/api/admin/financial-period-reviews/${reviewId}/not-applicable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerNote: "Marked N/A by admin" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      await fetchReviews();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResolving(null);
    }
  };

  const periodButtons = (review: ReviewRow) => {
    const ct = review.current_canonical_type;
    const isResolving = resolving === review.id;

    if (ct === "BALANCE_SHEET") {
      return (
        <div className="flex gap-2">
          <button
            onClick={() => resolveReview(review.id, "CURRENT")}
            disabled={isResolving}
            className="px-3 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            Current BS
          </button>
          <button
            onClick={() => resolveReview(review.id, "HISTORICAL")}
            disabled={isResolving}
            className="px-3 py-1 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
          >
            Historical BS
          </button>
        </div>
      );
    }

    if (ct === "INCOME_STATEMENT") {
      return (
        <div className="flex gap-2">
          <button
            onClick={() => resolveReview(review.id, "YTD")}
            disabled={isResolving}
            className="px-3 py-1 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
          >
            YTD
          </button>
          <button
            onClick={() => resolveReview(review.id, "ANNUAL")}
            disabled={isResolving}
            className="px-3 py-1 text-xs font-medium rounded bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
          >
            Annual
          </button>
        </div>
      );
    }

    // FINANCIAL_STATEMENT — needs sub-type first
    return (
      <span className="text-xs text-white/40">Needs sub-type confirmation</span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Financial Statement Period Review</h1>
          <p className="text-sm text-white/50 mt-1">
            Documents classified correctly but with ambiguous reporting period.
          </p>
        </div>
        <button
          onClick={seedReviews}
          disabled={seeding}
          className="px-4 py-2 text-sm font-medium rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-50"
        >
          {seeding ? "Scanning..." : "Scan for Candidates"}
        </button>
      </div>

      {seedResult && (
        <div className="p-3 rounded bg-white/5 text-sm text-white/70 font-mono">
          Found {seedResult.candidatesFound} candidates, {seedResult.alreadyOpen} already open, {seedResult.seeded} new reviews seeded.
        </div>
      )}

      {error && (
        <div className="p-3 rounded bg-red-900/30 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="text-white/50 text-sm">Loading...</div>
      ) : reviews.length === 0 ? (
        <div className="p-6 rounded bg-white/5 text-center text-white/40 text-sm">
          No open period reviews. Click "Scan for Candidates" to detect ambiguous documents.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-white/50 uppercase border-b border-white/10">
              <tr>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Current Key</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {reviews.map((r) => (
                <tr key={r.id} className="hover:bg-white/5">
                  <td className="px-3 py-3 text-white/80 font-mono text-xs">
                    {r.deal_documents?.original_filename ?? r.document_id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-3">
                    <span className="px-2 py-0.5 rounded bg-white/10 text-xs text-white/70 font-mono">
                      {r.current_canonical_type}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-white/50 font-mono">
                    {r.current_checklist_key ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-xs text-white/50">
                    {r.current_statement_period ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-xs text-white/40 max-w-xs truncate">
                    {r.review_reason}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2 items-center">
                      {periodButtons(r)}
                      <button
                        onClick={() => markNotApplicable(r.id)}
                        disabled={resolving === r.id}
                        className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-white/40 disabled:opacity-50"
                      >
                        N/A
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
