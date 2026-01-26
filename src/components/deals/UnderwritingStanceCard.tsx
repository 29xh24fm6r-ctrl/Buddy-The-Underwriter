"use client";

import { useEffect, useState } from "react";
import type { UnderwritingStanceResult } from "@/lib/underwrite/deriveUnderwritingStance";

type Props = {
  dealId: string;
  /** Optional: pass stance directly if already loaded (e.g., from context) */
  initialStance?: UnderwritingStanceResult | null;
};

/**
 * UnderwritingStanceCard
 *
 * Displays Buddy's underwriting posture for a deal.
 * This is deterministic, not AI-generated — it reflects actual evidence state.
 *
 * Placement: Above the checklist. Always visible. No click required.
 */
export default function UnderwritingStanceCard({ dealId, initialStance }: Props) {
  const [stance, setStance] = useState<UnderwritingStanceResult | null>(initialStance ?? null);
  const [loading, setLoading] = useState(!initialStance);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If we have an initial stance, don't fetch
    if (initialStance) {
      setStance(initialStance);
      setLoading(false);
      return;
    }

    let alive = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/deals/${dealId}/context`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;

        if (json?.underwritingStance) {
          setStance(json.underwritingStance);
        } else {
          setStance(null);
        }
      } catch (e: unknown) {
        if (!alive) return;
        setError((e as Error)?.message ?? "Failed to load stance");
        setStance(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    if (dealId) load();

    return () => {
      alive = false;
    };
  }, [dealId, initialStance]);

  // Update when initialStance prop changes (e.g., after upload)
  useEffect(() => {
    if (initialStance) {
      setStance(initialStance);
    }
  }, [initialStance]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-slate-300" />
          Analyzing deal readiness...
        </div>
      </div>
    );
  }

  if (error || !stance) {
    return null; // Fail silently — this is non-critical UI
  }

  // Style variants based on stance
  const stanceStyles: Record<string, { bg: string; border: string; icon: string; iconColor: string }> = {
    ready_for_underwriting: {
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      icon: "checkmark",
      iconColor: "text-emerald-600",
    },
    blocked_on_cash_flow: {
      bg: "bg-amber-50",
      border: "border-amber-200",
      icon: "clock",
      iconColor: "text-amber-600",
    },
    blocked_on_liquidity: {
      bg: "bg-amber-50",
      border: "border-amber-200",
      icon: "clock",
      iconColor: "text-amber-600",
    },
    blocked_on_both: {
      bg: "bg-amber-50",
      border: "border-amber-200",
      icon: "clock",
      iconColor: "text-amber-600",
    },
    insufficient_information: {
      bg: "bg-slate-50",
      border: "border-slate-200",
      icon: "info",
      iconColor: "text-slate-500",
    },
  };

  const style = stanceStyles[stance.stance] ?? stanceStyles.insufficient_information;

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-4`}>
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <StanceIcon type={style.icon} className={style.iconColor} />
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Buddy's Take
        </span>
      </div>

      {/* Headline */}
      <p className="text-sm font-semibold text-slate-900">{stance.headline}</p>

      {/* Explanation (if present) */}
      {stance.explanation && (
        <p className="mt-1 text-sm text-slate-600">{stance.explanation}</p>
      )}

      {/* Missing signals hint (for blocked states) */}
      {stance.missingSignals.length > 0 && stance.stance !== "ready_for_underwriting" && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {stance.missingSignals.slice(0, 3).map((signal) => (
            <span
              key={signal}
              className="inline-flex items-center rounded-full bg-white/60 px-2 py-0.5 text-xs text-slate-600"
            >
              {formatSignalName(signal)}
            </span>
          ))}
          {stance.missingSignals.length > 3 && (
            <span className="inline-flex items-center rounded-full bg-white/60 px-2 py-0.5 text-xs text-slate-500">
              +{stance.missingSignals.length - 3} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Simple icon component for stance states
 */
function StanceIcon({ type, className }: { type: string; className?: string }) {
  const baseClass = `h-4 w-4 ${className ?? ""}`;

  if (type === "checkmark") {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (type === "clock") {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 6v6l4 2" />
      </svg>
    );
  }

  // Default: info icon
  return (
    <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

/**
 * Format a checklist key into a human-readable name
 */
function formatSignalName(key: string): string {
  const map: Record<string, string> = {
    PFS_CURRENT: "Personal Financial Statement",
    FIN_STMT_BS_YTD: "Balance Sheet",
    FIN_STMT_PL_YTD: "P&L Statement",
    IRS_PERSONAL_3Y: "Personal Tax Returns",
    IRS_BUSINESS_3Y: "Business Tax Returns",
  };
  return map[key] ?? key.replace(/_/g, " ");
}
