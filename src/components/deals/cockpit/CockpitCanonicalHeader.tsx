"use client";

import { useCockpitStateContext } from "@/hooks/useCockpitState";

/**
 * Cockpit header wired exclusively to cockpit-state canonical endpoint.
 * Hard fails on missing borrower — does NOT render "Borrower not set".
 */
export function CockpitCanonicalHeader() {
  const { state, loading, error } = useCockpitStateContext();

  if (loading) {
    return (
      <div className="animate-pulse h-12 bg-white/5 rounded-lg" />
    );
  }

  if (error || !state) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
        <p className="text-sm font-semibold text-red-400">
          Deal data unavailable — contact support
        </p>
        {error && (
          <p className="text-xs text-red-300/60 mt-1">{error.message}</p>
        )}
      </div>
    );
  }

  const { deal, readiness } = state;

  // Hard rule: missing borrower is an error state, not a soft fallback
  if (!deal.borrower || !deal.borrower.legalName) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
        <p className="text-sm font-semibold text-red-400">
          Borrower data unavailable — contact support
        </p>
        <p className="text-xs text-red-300/60 mt-1">
          Deal ID: {deal.id}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-white truncate">
          {deal.dealName}
        </h1>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm text-white/70">
            {deal.borrower.legalName}
          </span>
          {deal.bank && (
            <span className="text-xs text-white/40">
              {deal.bank.name}
            </span>
          )}
          <span className="text-xs text-white/40 capitalize">
            {deal.lifecycleStage.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          <span className="text-2xl font-mono font-bold text-white">
            {readiness.percent}%
          </span>
          <span className="text-xs text-white/50 block">Ready</span>
        </div>
      </div>
    </div>
  );
}
