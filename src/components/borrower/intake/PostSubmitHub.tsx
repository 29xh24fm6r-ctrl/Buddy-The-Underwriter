"use client";

import { useEffect, useState, useCallback } from "react";
import { IdentityVerificationPanel } from "./IdentityVerificationPanel";
import { ApprovalScoreCard } from "./ApprovalScoreCard";
import { TridentPreviewCard } from "@/components/borrower/TridentPreviewCard";

type Milestone = {
  key: string;
  label: string;
  complete: boolean;
  detail: string | null;
};

type NextAction = {
  key: string;
  label: string;
  actionUrl?: string;
};

type HubData = {
  applicationStatus: string;
  completedSections: string[];
  milestones: Milestone[];
  nextActions: NextAction[];
};

export function PostSubmitHub({ token }: { token: string }) {
  const [hub, setHub] = useState<HubData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/borrower/portal/${token}/hub`);
      const json = await res.json();
      if (json?.ok) {
        setHub(json);
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center">
        <div className="w-8 h-8 border-2 border-brand-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-500">Loading your application status...</p>
      </div>
    );
  }

  if (!hub) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center">
        <p className="text-sm text-slate-500">Unable to load application status. Please try again later.</p>
      </div>
    );
  }

  const completedCount = hub.milestones.filter((m) => m.complete).length;
  const totalCount = hub.milestones.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="max-w-lg mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200">
          <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Application Submitted</h1>
        <p className="text-sm text-slate-600">
          Your application is being processed. Complete the remaining items below to
          move your loan package forward.
        </p>
      </div>

      {/* Overall progress */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-slate-800">Package Progress</span>
          <span className="text-slate-500">{completedCount}/{totalCount} steps</span>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Next Actions */}
      {hub.nextActions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Next Steps</h2>
          <div className="space-y-2">
            {hub.nextActions.map((action) => (
              <div
                key={action.key}
                className="flex items-center gap-3 border border-amber-200 bg-amber-50 rounded-lg px-4 py-3"
              >
                <span className="text-amber-500 text-lg">!</span>
                <span className="text-sm text-amber-800">{action.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Milestones</h2>
        <div className="space-y-3">
          {hub.milestones.map((m) => (
            <div key={m.key} className="flex items-start gap-3">
              <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                m.complete ? "bg-emerald-500" : "bg-slate-200"
              }`}>
                {m.complete ? (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className="w-2 h-2 rounded-full bg-slate-400" />
                )}
              </div>
              <div>
                <p className={`text-sm ${m.complete ? "text-slate-800 font-medium" : "text-slate-500"}`}>
                  {m.label}
                </p>
                {m.detail && (
                  <p className="text-xs text-slate-400 mt-0.5">{m.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Identity Verification */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Identity Verification</h2>
        <IdentityVerificationPanel token={token} />
      </div>

      {/* Buddy Package — Trident bundle */}
      <TridentPreviewCard token={token} />

      {/* Approval Score */}
      <ApprovalScoreCard token={token} />

      {/* Refresh */}
      <div className="text-center">
        <button
          type="button"
          onClick={() => { setLoading(true); load(); }}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          Refresh Status
        </button>
      </div>
    </div>
  );
}
