"use client";

import { useEffect, useState } from "react";

type EligibilityFailureSlim = {
  check: string;
  reason: string;
};

type BorrowerScore = {
  score: number;
  band: string;
  eligibilityPassed: boolean;
  eligibilityFailures?: EligibilityFailureSlim[];
  topStrengths: string[];
  topWeaknesses: string[];
  narrative: string;
  computedAt: string | null;
};

function hasIncompleteInputs(failures: EligibilityFailureSlim[]): boolean {
  return failures.some(
    (f) =>
      f.check.endsWith("_unknown") ||
      f.reason.toLowerCase().includes("manual review required"),
  );
}

const BAND_LABELS: Record<string, { label: string; color: string }> = {
  institutional_prime: { label: "Institutional Prime", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  strong_fit: { label: "Strong Fit", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  selective_fit: { label: "Selective Fit", color: "text-amber-700 bg-amber-50 border-amber-200" },
  specialty_lender: { label: "Specialty Lender", color: "text-orange-700 bg-orange-50 border-orange-200" },
  not_eligible: { label: "Not Eligible", color: "text-rose-700 bg-rose-50 border-rose-200" },
};

export function ApprovalScoreCard({ token }: { token: string }) {
  const [score, setScore] = useState<BorrowerScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/borrower/portal/${token}/score`);
        const json = await res.json();
        if (cancelled) return;
        if (json?.ok && json.score) {
          setScore(json.score);
        }
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="border border-slate-200 rounded-xl p-6 space-y-3 bg-white shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 border-2 border-brand-blue-500 border-t-transparent rounded-full animate-spin" />
          Loading approval score...
        </div>
      </div>
    );
  }

  if (!score || hasIncompleteInputs(score.eligibilityFailures ?? [])) {
    return (
      <div className="border border-slate-200 rounded-xl p-6 bg-white shadow-sm">
        <p className="text-sm text-slate-500">
          Your approval score will appear here after your application is reviewed.
        </p>
      </div>
    );
  }

  const band = BAND_LABELS[score.band] ?? { label: score.band, color: "text-slate-700 bg-slate-50 border-slate-200" };
  const pct = Math.round(score.score);

  return (
    <div className="border border-slate-200 rounded-xl p-6 space-y-4 bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Approval Score</h3>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${band.color}`}>
          {band.label}
        </span>
      </div>

      {/* Score bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-500">
          <span>0</span>
          <span className="text-lg font-bold text-slate-900">{pct}</span>
          <span>100</span>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: pct >= 70 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444",
            }}
          />
        </div>
      </div>

      {!score.eligibilityPassed && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-700">
          There are eligibility items that need attention. Your banker will review these with you.
        </div>
      )}

      {score.narrative && (
        <p className="text-sm text-slate-600">{score.narrative}</p>
      )}

      {score.topStrengths.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Strengths</h4>
          <ul className="space-y-1">
            {score.topStrengths.map((s, i) => (
              <li key={i} className="text-sm text-emerald-700 flex items-start gap-1.5">
                <span className="mt-0.5 text-emerald-500">+</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {score.topWeaknesses.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Areas to Strengthen</h4>
          <ul className="space-y-1">
            {score.topWeaknesses.map((w, i) => (
              <li key={i} className="text-sm text-amber-700 flex items-start gap-1.5">
                <span className="mt-0.5 text-amber-500">-</span> {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
