"use client";

import { useState, useEffect, useCallback } from "react";

interface RiskProfile {
  industryScore: number;
  businessAgeScore: number;
  loanTermScore: number;
  locationScore: number;
  compositeScore: number;
  riskTier: "LOW" | "MODERATE" | "ELEVATED" | "HIGH";
  explanations: {
    industry: string;
    businessAge: string;
    loanTerm: string;
    location: string;
    overall: string;
  };
}

interface NewBusinessResult {
  isNewBusiness: boolean;
  businessAgeMonths: number | null;
  dscrThreshold: number;
  flags: Array<{
    code: string;
    message: string;
    severity: "INFO" | "WARN" | "BLOCK";
  }>;
  projectionsRequired: boolean;
  managementExperienceElevated: boolean;
}

interface Props {
  dealId: string;
}

function tierColor(tier: string): string {
  switch (tier) {
    case "LOW":
      return "text-emerald-400";
    case "MODERATE":
      return "text-blue-400";
    case "ELEVATED":
      return "text-amber-400";
    case "HIGH":
      return "text-red-400";
    default:
      return "text-white/60";
  }
}

function tierBg(tier: string): string {
  switch (tier) {
    case "LOW":
      return "bg-emerald-500/10 border-emerald-500/30";
    case "MODERATE":
      return "bg-blue-500/10 border-blue-500/30";
    case "ELEVATED":
      return "bg-amber-500/10 border-amber-500/30";
    case "HIGH":
      return "bg-red-500/10 border-red-500/30";
    default:
      return "bg-white/5 border-white/10";
  }
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 55) return "text-blue-400";
  if (score >= 35) return "text-amber-400";
  return "text-red-400";
}

function ScoreBar({ label, score, weight, explanation }: {
  label: string;
  score: number;
  weight: string;
  explanation: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/70">
          {label} <span className="text-white/40">({weight})</span>
        </span>
        <span className={`font-mono font-semibold ${scoreColor(score)}`}>
          {score}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            score >= 75
              ? "bg-emerald-500"
              : score >= 55
                ? "bg-blue-500"
                : score >= 35
                  ? "bg-amber-500"
                  : "bg-red-500"
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="text-[10px] text-white/40">{explanation}</p>
    </div>
  );
}

function FlagBadge({ flag }: {
  flag: { code: string; message: string; severity: "INFO" | "WARN" | "BLOCK" };
}) {
  const colors = {
    INFO: "bg-blue-500/10 border-blue-500/30 text-blue-300",
    WARN: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    BLOCK: "bg-red-500/10 border-red-500/30 text-red-300",
  };

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs ${colors[flag.severity]}`}
    >
      <span className="font-semibold">{flag.severity}</span>
      <span className="mx-1.5 text-white/20">|</span>
      {flag.message}
    </div>
  );
}

export default function SBARiskProfilePanel({ dealId }: Props) {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<RiskProfile | null>(null);
  const [newBusiness, setNewBusiness] = useState<NewBusinessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/deals/${dealId}/sba/risk-profile`);
      const data = await resp.json();
      if (data.ok) {
        setProfile(data.riskProfile);
        setNewBusiness(data.newBusiness);
      } else {
        setError(data.error ?? "Failed to load risk profile");
      }
    } catch {
      setError("Failed to load risk profile");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex items-center justify-center min-h-[200px]">
        <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <p className="text-sm text-red-300">{error}</p>
        <button
          onClick={loadProfile}
          className="mt-2 text-xs text-blue-400 hover:text-blue-300"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-4">
      {/* Composite Score + Tier */}
      <div
        className={`rounded-xl border p-4 ${tierBg(profile.riskTier)}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white/80">
              SBA Risk Profile
            </h3>
            <p className="text-xs text-white/50 mt-0.5">
              {profile.explanations.overall}
            </p>
          </div>
          <div className="text-right">
            <div
              className={`text-2xl font-bold font-mono ${tierColor(profile.riskTier)}`}
            >
              {profile.compositeScore}
            </div>
            <div
              className={`text-xs font-semibold ${tierColor(profile.riskTier)}`}
            >
              {profile.riskTier}
            </div>
          </div>
        </div>
      </div>

      {/* Component Scores */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wide">
          Component Scores
        </h4>
        <ScoreBar
          label="Industry"
          score={profile.industryScore}
          weight="40%"
          explanation={profile.explanations.industry}
        />
        <ScoreBar
          label="Business Age"
          score={profile.businessAgeScore}
          weight="35%"
          explanation={profile.explanations.businessAge}
        />
        <ScoreBar
          label="Loan Term"
          score={profile.loanTermScore}
          weight="15%"
          explanation={profile.explanations.loanTerm}
        />
        <ScoreBar
          label="Location"
          score={profile.locationScore}
          weight="10%"
          explanation={profile.explanations.location}
        />
      </div>

      {/* New Business Protocol */}
      {newBusiness && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
          <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wide">
            New Business Protocol
          </h4>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-white/50 text-xs">Status</span>
              <div
                className={`font-semibold ${
                  newBusiness.isNewBusiness
                    ? "text-amber-400"
                    : "text-emerald-400"
                }`}
              >
                {newBusiness.isNewBusiness
                  ? "New Business"
                  : "Established"}
              </div>
            </div>
            <div>
              <span className="text-white/50 text-xs">DSCR Threshold</span>
              <div className="text-white font-mono">
                {newBusiness.dscrThreshold.toFixed(2)}x
              </div>
            </div>
            <div>
              <span className="text-white/50 text-xs">Age</span>
              <div className="text-white font-mono">
                {newBusiness.businessAgeMonths !== null
                  ? `${(newBusiness.businessAgeMonths / 12).toFixed(1)} yrs`
                  : "Unknown"}
              </div>
            </div>
          </div>

          {newBusiness.flags.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {newBusiness.flags.map((flag) => (
                <FlagBadge key={flag.code} flag={flag} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Refresh */}
      <button
        onClick={loadProfile}
        disabled={loading}
        className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
      >
        Refresh Profile
      </button>
    </div>
  );
}
