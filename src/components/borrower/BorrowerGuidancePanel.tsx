"use client";

import { useEffect, useState } from "react";

type GuidanceAction = {
  type: string;
  title: string;
  description: string;
  rationale: string;
  linkedConditionId: string | null;
  priority: string;
  estimatedMinutes: number | null;
  ctaLabel: string;
};

type Readiness = {
  score: number;
  label: string;
  milestone: string;
  summary: string;
  blockersCount: number;
  criticalItemsRemaining: number;
  docsWaitingReview: number;
  docsRejectedCount: number;
  partialItemsCount: number;
};

type GuidancePayload = {
  primaryNextAction: GuidanceAction | null;
  secondaryActions: GuidanceAction[];
  readiness: Readiness;
  blockers: string[];
  milestones: Record<string, boolean>;
  warnings: string[];
};

const PROGRESS_COLORS: Record<string, string> = {
  "Getting started": "bg-gray-400",
  "Building your file": "bg-blue-500",
  "Making strong progress": "bg-amber-500",
  "Almost underwriter-ready": "bg-emerald-500",
  "File ready for review": "bg-emerald-600",
};

export function BorrowerGuidancePanel({ token }: { token: string }) {
  const [guidance, setGuidance] = useState<GuidancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/portal/${token}/guidance`, { cache: "no-store" });
        const data = await res.json();
        if (data?.ok) {
          setGuidance(data.guidance);
        } else {
          setError(data?.error ?? "Failed to load guidance");
        }
      } catch {
        setError("Unable to load guidance");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-24 bg-gray-100 rounded-lg" />
        <div className="h-16 bg-gray-100 rounded-lg" />
      </div>
    );
  }

  if (error || !guidance) {
    return (
      <div className="border border-amber-200 rounded-lg p-4 bg-amber-50 text-sm text-amber-800">
        {error ?? "Guidance unavailable"}
      </div>
    );
  }

  const { readiness, primaryNextAction, secondaryActions, blockers, warnings } = guidance;
  const barColor = PROGRESS_COLORS[readiness.label] ?? "bg-gray-400";

  return (
    <div className="space-y-4">
      {/* Progress / Readiness Card */}
      <div className="border rounded-lg p-4 bg-white">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold">{readiness.label}</span>
          <span className="text-xs text-gray-500">{readiness.score}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
          <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${readiness.score}%` }} />
        </div>
        <p className="text-xs text-gray-600">{readiness.milestone}</p>
        <p className="text-xs text-gray-500 mt-1">{readiness.summary}</p>
      </div>

      {/* Primary Next Action */}
      {primaryNextAction && primaryNextAction.type !== "wait_for_review" && (
        <div className="border-2 border-gray-900 rounded-lg p-4 bg-gray-50">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Your Next Step</div>
          <h3 className="font-semibold text-sm">{primaryNextAction.title}</h3>
          <p className="text-xs text-gray-600 mt-1">{primaryNextAction.description}</p>
          <p className="text-xs text-gray-400 mt-1 italic">{primaryNextAction.rationale}</p>
          {primaryNextAction.estimatedMinutes && (
            <p className="text-xs text-gray-400 mt-1">Estimated time: ~{primaryNextAction.estimatedMinutes} min</p>
          )}
        </div>
      )}

      {/* Wait State */}
      {primaryNextAction?.type === "wait_for_review" && (
        <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
          <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-1">Status</div>
          <h3 className="font-semibold text-sm text-blue-800">{primaryNextAction.title}</h3>
          <p className="text-xs text-blue-700 mt-1">{primaryNextAction.description}</p>
        </div>
      )}

      {/* Blockers */}
      {blockers.length > 0 && (
        <div className="border border-red-200 rounded-lg p-3 bg-red-50">
          <div className="text-xs font-bold text-red-600 uppercase tracking-wide mb-1">Action Needed</div>
          <ul className="text-xs text-red-700 space-y-1">
            {blockers.map((b, i) => <li key={i}>&#8226; {b}</li>)}
          </ul>
        </div>
      )}

      {/* Secondary Actions */}
      {secondaryActions.length > 0 && (
        <div className="border rounded-lg bg-white overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b">
            <span className="text-xs font-semibold text-gray-500">Also Needed</span>
          </div>
          <div className="divide-y">
            {secondaryActions.map((a, i) => (
              <div key={i} className="px-4 py-2">
                <span className="text-xs font-medium">{a.title}</span>
                <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${
                  a.priority === "critical" ? "bg-red-100 text-red-700" :
                  a.priority === "high" ? "bg-amber-100 text-amber-700" :
                  "bg-gray-100 text-gray-600"
                }`}>
                  {a.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="text-xs text-gray-500 italic">
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}
    </div>
  );
}
