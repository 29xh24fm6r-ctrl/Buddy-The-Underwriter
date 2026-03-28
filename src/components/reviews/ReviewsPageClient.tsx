"use client";

/**
 * Phase 65J — Reviews Page Client
 */

import { useCallback, useEffect, useState } from "react";
import ReviewCasePanel from "./ReviewCasePanel";
import ReviewRequirementsTable from "./ReviewRequirementsTable";

type Props = { dealId: string };

type ReviewsData = {
  annualReviewCases: Array<{
    id: string; reviewYear: number; status: string; readinessState: string;
    dueAt: string; borrowerCampaignId: string | null;
    pendingRequirementCount: number; openExceptionCount: number;
  }>;
  renewalCases: Array<{
    id: string; targetMaturityDate: string; status: string; readinessState: string;
    dueAt: string; borrowerCampaignId: string | null;
    pendingRequirementCount: number; openExceptionCount: number;
  }>;
  requirements: Array<{
    id: string; caseType: string; caseId: string; requirementCode: string;
    title: string; description: string; borrowerVisible: boolean;
    status: string; required: boolean; evidenceType: string;
  }>;
  exceptions: Array<{ id: string; caseType: string; exceptionCode: string; severity: string; status: string }>;
  outputs: Array<{ id: string; caseType: string; outputType: string; status: string; artifactRef: string | null }>;
};

export default function ReviewsPageClient({ dealId }: Props) {
  const [data, setData] = useState<ReviewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/reviews`);
      const json = await res.json();
      if (json.ok) setData(json);
    } catch (err) { console.error("[Reviews] fetch failed:", err); }
    finally { setLoading(false); }
  }, [dealId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleStartReview(caseType: string, caseId: string) {
    setActionLoading(true);
    try {
      await fetch(`/api/deals/${dealId}/reviews/${caseType}/${caseId}/review-start`, { method: "POST" });
      await fetchData();
    } finally { setActionLoading(false); }
  }

  async function handleComplete(caseType: string, caseId: string) {
    setActionLoading(true);
    try {
      await fetch(`/api/deals/${dealId}/reviews/${caseType}/${caseId}/complete`, { method: "POST" });
      await fetchData();
    } finally { setActionLoading(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><p className="text-white/40 text-sm">Loading reviews...</p></div>;

  const arCases = (data?.annualReviewCases ?? []).map((c) => ({
    ...c, label: `Annual Review ${c.reviewYear}`,
  }));
  const rnCases = (data?.renewalCases ?? []).map((c) => ({
    ...c, label: `Renewal — ${new Date(c.targetMaturityDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`,
  }));

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-lg font-bold text-white/90">Annual Reviews & Renewals</h2>

      {arCases.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-2">Annual Reviews</h3>
          <ReviewCasePanel cases={arCases} onStartReview={(_, id) => handleStartReview("annual_review", id)} onComplete={(_, id) => handleComplete("annual_review", id)} loading={actionLoading} />
        </div>
      )}

      {rnCases.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-2">Renewals</h3>
          <ReviewCasePanel cases={rnCases} onStartReview={(_, id) => handleStartReview("renewal", id)} onComplete={(_, id) => handleComplete("renewal", id)} loading={actionLoading} />
        </div>
      )}

      {(data?.requirements ?? []).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-2">Requirements</h3>
          <ReviewRequirementsTable requirements={data?.requirements ?? []} />
        </div>
      )}

      {(data?.exceptions ?? []).length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h4 className="text-xs font-semibold text-white/70 uppercase mb-2">Open Exceptions ({data!.exceptions.length})</h4>
          {data!.exceptions.map((ex) => (
            <div key={ex.id} className="flex items-center gap-2 py-1 text-xs">
              <span className={ex.severity === "critical" ? "text-red-400" : ex.severity === "urgent" ? "text-amber-400" : "text-yellow-400"}>
                {ex.severity.toUpperCase()}
              </span>
              <span className="text-white/60">{ex.exceptionCode.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      )}

      {arCases.length === 0 && rnCases.length === 0 && (
        <div className="text-center text-white/30 py-12 text-sm">No annual review or renewal cases for this deal yet.</div>
      )}
    </div>
  );
}
