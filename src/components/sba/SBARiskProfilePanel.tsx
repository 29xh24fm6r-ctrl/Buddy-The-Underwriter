"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types (mirrored from sbaRiskProfile.ts for client use)
// ---------------------------------------------------------------------------

interface SBARiskProfileFactor {
  factorName: string;
  label: string;
  tier: "low" | "medium" | "high" | "very_high" | "unknown";
  riskScore: number;
  narrative: string;
  source: string;
}

interface SBARiskProfile {
  dealId: string;
  computedAt: string;
  loanType: string;
  industryFactor: SBARiskProfileFactor;
  businessAgeFactor: SBARiskProfileFactor;
  loanTermFactor: SBARiskProfileFactor;
  urbanRuralFactor: SBARiskProfileFactor;
  compositeRiskScore: number;
  compositeRiskTier: "low" | "medium" | "high" | "very_high";
  compositeNarrative: string;
  requiresProjectedDscr: boolean;
  projectedDscrThreshold: number;
  equityInjectionFloor: number;
  hardBlockers: string[];
  softWarnings: string[];
}

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

const TIER_COLORS: Record<string, string> = {
  low: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  very_high: "text-red-400 bg-red-500/10 border-red-500/30",
  unknown: "text-white/60 bg-white/5 border-white/10",
};

function scoreBarColor(score: number): string {
  if (score < 2.0) return "bg-emerald-500";
  if (score < 3.0) return "bg-amber-500";
  if (score < 4.0) return "bg-orange-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FactorRow({ factor }: { factor: SBARiskProfileFactor }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="py-2 border-b border-white/5 last:border-0">
      <div
        className="flex items-center justify-between gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-sm text-white/80 font-medium">
          {factor.label}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded border font-semibold ${TIER_COLORS[factor.tier]}`}
        >
          {factor.tier.replace("_", " ").toUpperCase()}
        </span>
      </div>
      {expanded && (
        <p className="mt-1 text-xs text-white/50 leading-relaxed">
          {factor.narrative}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function SBARiskProfilePanel({
  dealId,
}: {
  dealId: string;
}) {
  const [profile, setProfile] = useState<SBARiskProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch(`/api/deals/${dealId}/sba?view=risk-profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.profile) setProfile(d.profile);
      })
      .catch((e) => console.error("[SBARiskProfilePanel]", e))
      .finally(() => setLoading(false));
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm text-white/40 animate-pulse">
          Loading SBA risk profile...
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const barWidth = `${((profile.compositeRiskScore - 1) / 4) * 100}%`;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer bg-white/[0.02] border-b border-white/10"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white/80">
            SBA Risk Intelligence
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded border font-semibold ${TIER_COLORS[profile.compositeRiskTier]}`}
          >
            {profile.compositeRiskTier.replace("_", " ").toUpperCase()} &mdash;{" "}
            {profile.compositeRiskScore.toFixed(1)}/5.0
          </span>
        </div>
        <span className="text-white/40 text-xs">
          {collapsed ? "Show" : "Hide"}
        </span>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-3">
          {/* Score bar */}
          <div className="w-full bg-white/10 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${scoreBarColor(profile.compositeRiskScore)}`}
              style={{ width: barWidth }}
            />
          </div>
          <p className="text-xs text-white/50">
            {profile.compositeNarrative}
          </p>

          {/* New Business Protocol Banner */}
          {profile.requiresProjectedDscr && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-600/10 px-3 py-2">
              <p className="text-xs font-semibold text-amber-300">
                New Business Underwriting Protocol Active
              </p>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Projected DSCR of {profile.projectedDscrThreshold}x required
                (not historical). Business plan with 3-year projections
                mandatory per SBA SOP 50 10 8. Equity injection floor:{" "}
                {(profile.equityInjectionFloor * 100).toFixed(0)}%.
              </p>
            </div>
          )}

          {/* Four factor rows */}
          <div>
            <FactorRow factor={profile.industryFactor} />
            <FactorRow factor={profile.businessAgeFactor} />
            <FactorRow factor={profile.loanTermFactor} />
            <FactorRow factor={profile.urbanRuralFactor} />
          </div>

          {/* Hard blockers */}
          {profile.hardBlockers.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-600/10 px-3 py-2 space-y-1">
              <p className="text-xs font-semibold text-red-300">
                Hard Blockers
              </p>
              {profile.hardBlockers.map((b, i) => (
                <p key={i} className="text-xs text-red-200/80">
                  &bull; {b}
                </p>
              ))}
            </div>
          )}

          {/* Soft warnings */}
          {profile.softWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-600/10 px-3 py-2 space-y-1">
              <p className="text-xs font-semibold text-amber-300">
                Warnings
              </p>
              {profile.softWarnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-200/80">
                  &bull; {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
