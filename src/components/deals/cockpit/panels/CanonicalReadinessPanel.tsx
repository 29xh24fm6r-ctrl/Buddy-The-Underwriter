"use client";

import { useCockpitStateContext } from "@/hooks/useCockpitState";

const CATEGORY_LABELS: Record<string, string> = {
  documents: "Documents",
  loan_request: "Loan Request",
  spreads: "Spreads",
  financials: "Financial Snapshot",
  pricing_quote: "Pricing",
  decision: "Decision",
  underwriting: "Underwriting",
  risk_pricing: "Risk & Pricing",
  ai_pipeline: "AI Pipeline",
  pricing_setup: "Pricing Setup",
};

const STATUS_STYLES: Record<string, { bg: string; icon: string }> = {
  complete: { bg: "bg-emerald-500/20 text-emerald-300", icon: "\u2713" },
  warning: { bg: "bg-amber-500/20 text-amber-300", icon: "\u25CB" },
  blocking: { bg: "bg-red-500/20 text-red-300", icon: "\u2717" },
};

/**
 * Readiness panel wired to cockpit-state canonical endpoint.
 * Derives ONLY from cockpit-state.readiness — no independent document queries.
 */
export function CanonicalReadinessPanel() {
  const { state, loading } = useCockpitStateContext();

  if (loading || !state) {
    return <div className="animate-pulse h-40 bg-white/5 rounded" />;
  }

  const { readiness, blockers } = state;

  return (
    <div className="space-y-4">
      {/* Readiness percent */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${readiness.percent}%` }}
          />
        </div>
        <span className="text-sm font-mono text-white/60 shrink-0">
          {readiness.percent}%
        </span>
      </div>

      {/* Categories */}
      <div className="space-y-1">
        {readiness.categories.map((cat) => {
          const style = STATUS_STYLES[cat.status] ?? STATUS_STYLES.warning;
          return (
            <div
              key={cat.code}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <span className="text-sm text-white/80">
                {CATEGORY_LABELS[cat.code] ?? cat.code}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${style.bg}`}
              >
                {style.icon} {cat.status === "complete" ? "Complete" : cat.status === "blocking" ? "Blocking" : "Warning"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Blockers — explicit, actionable */}
      {blockers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Blockers
          </h4>
          {blockers.map((blocker, i) => (
            <div
              key={i}
              className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2"
            >
              <div className="text-sm font-medium text-red-300">
                {blocker.title}
              </div>
              {blocker.details.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {blocker.details.map((detail, j) => (
                    <li key={j} className="text-xs text-red-200/60">
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
              {blocker.actionLabel && (
                <button className="mt-1.5 text-xs text-blue-400 hover:text-blue-300">
                  {blocker.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
