"use client";

// src/components/feasibility/FeasibilityDashboard.tsx
// Phase God Tier Feasibility — Dashboard UI (step 13/16).
// Renders the latest feasibility study: composite gauge, 4 dimension
// bars with expandable sub-dimensions, flag panel, action bar.

import { useCallback, useEffect, useState } from "react";

interface DimensionScoreLite {
  score: number;
  weight: number;
  dataSource: string;
  dataAvailable: boolean;
  detail: string;
}

interface MarketFlagLite {
  severity: "info" | "warning" | "critical";
  dimension: string;
  message: string;
}

interface StudyRow {
  id: string;
  composite_score: number;
  recommendation: string;
  confidence_level: string;
  market_demand_score: number;
  financial_viability_score: number;
  operational_readiness_score: number;
  location_suitability_score: number;
  data_completeness: number;
  flags: MarketFlagLite[];
  is_franchise: boolean;
  pdf_url: string | null;
  status: string;
  version_number: number;
  created_at: string;
  market_demand_detail?: {
    populationAdequacy?: DimensionScoreLite;
    incomeAlignment?: DimensionScoreLite;
    competitiveDensity?: DimensionScoreLite;
    demandTrend?: DimensionScoreLite;
  };
  financial_viability_detail?: {
    debtServiceCoverage?: DimensionScoreLite;
    breakEvenMargin?: DimensionScoreLite;
    capitalizationAdequacy?: DimensionScoreLite;
    cashRunway?: DimensionScoreLite;
    downsideResilience?: DimensionScoreLite;
  };
  operational_readiness_detail?: {
    managementExperience?: DimensionScoreLite;
    industryKnowledge?: DimensionScoreLite;
    staffingReadiness?: DimensionScoreLite;
    franchiseSupport?: DimensionScoreLite;
  };
  location_suitability_detail?: {
    economicHealth?: DimensionScoreLite;
    realEstateMarket?: DimensionScoreLite;
    accessAndVisibility?: DimensionScoreLite;
    riskExposure?: DimensionScoreLite;
  };
  narratives?: {
    executiveSummary?: string;
  };
}

interface Props {
  dealId: string;
}

function colorFor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 65) return "#2563eb";
  if (score >= 50) return "#d97706";
  if (score >= 35) return "#ea580c";
  return "#dc2626";
}

function recommendationColor(rec: string): string {
  if (rec === "Strongly Recommended") return "#16a34a";
  if (rec === "Recommended") return "#2563eb";
  if (rec === "Conditionally Feasible") return "#d97706";
  if (rec === "Significant Concerns") return "#ea580c";
  return "#dc2626";
}

export default function FeasibilityDashboard({ dealId }: Props) {
  const [loading, setLoading] = useState(true);
  const [study, setStudy] = useState<StudyRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Phase 2 — SSE progress overlay
  const [progressStep, setProgressStep] = useState<string>("Starting…");
  const [progressPct, setProgressPct] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/feasibility/latest`);
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Failed to load feasibility study");
        return;
      }
      setStudy((json.study as StudyRow | null) ?? null);
    } catch {
      setError("Network error loading feasibility study");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setProgressStep("Starting…");
    setProgressPct(0);

    try {
      const res = await fetch(`/api/deals/${dealId}/feasibility/generate`, {
        method: "POST",
        headers: { Accept: "text/event-stream" },
      });

      // Fallback: some runtimes won't hand back a streaming body. In that
      // case the route returned plain JSON — handle it like before.
      if (!res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
        const json = await res.json();
        if (!json.ok) setError(json.error ?? "Feasibility generation failed");
        await load();
        setGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finishedOrErrored = false;

      while (!finishedOrErrored) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        // Keep the trailing partial event in the buffer.
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim()) as {
              step?: string;
              pct?: number;
              error?: string;
            };
            if (typeof payload.step === "string") setProgressStep(payload.step);
            if (typeof payload.pct === "number") setProgressPct(payload.pct);
            if (payload.error) {
              setError(payload.error);
              finishedOrErrored = true;
              break;
            }
            if (payload.step === "Complete!") {
              await load();
              finishedOrErrored = true;
              break;
            }
          } catch {
            // Malformed SSE event — skip.
          }
        }
      }
    } catch {
      setError("Network error running feasibility");
    } finally {
      setGenerating(false);
    }
  }, [dealId, load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/60">
        Loading feasibility study…
      </div>
    );
  }

  if (!study) {
    return (
      <div className="space-y-5">
        {generating && (
          <FeasibilityProgressOverlay
            step={progressStep}
            pct={progressPct}
          />
        )}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center space-y-4">
          <h3 className="text-base font-semibold text-white">
            No feasibility study has been run for this deal yet.
          </h3>
          <p className="text-sm text-white/60">
            The engine consumes existing BIE research + SBA projections +
            financial spreading and produces a 20-30 page feasibility report
            with deterministic scoring across four dimensions.
          </p>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {generating
              ? "Running feasibility analysis…"
              : "Run Feasibility Study"}
          </button>
        </div>
      </div>
    );
  }

  const dimensions: Array<{
    key: string;
    label: string;
    score: number;
    detail: Record<string, DimensionScoreLite | undefined> | undefined;
  }> = [
    {
      key: "market",
      label: "Market Demand",
      score: study.market_demand_score,
      detail: study.market_demand_detail,
    },
    {
      key: "financial",
      label: "Financial Viability",
      score: study.financial_viability_score,
      detail: study.financial_viability_detail,
    },
    {
      key: "operational",
      label: "Operational Readiness",
      score: study.operational_readiness_score,
      detail: study.operational_readiness_detail,
    },
    {
      key: "location",
      label: "Location Suitability",
      score: study.location_suitability_score,
      detail: study.location_suitability_detail,
    },
  ];

  const criticalFlags = study.flags.filter((f) => f.severity === "critical");
  const warningFlags = study.flags.filter((f) => f.severity === "warning");
  const infoFlags = study.flags.filter((f) => f.severity === "info");

  return (
    <div className="space-y-5">
      {generating && (
        <FeasibilityProgressOverlay step={progressStep} pct={progressPct} />
      )}
      {/* Composite gauge */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 flex flex-col sm:flex-row gap-6 items-center">
        <div
          className="flex flex-col items-center justify-center h-32 w-32 rounded-full"
          style={{ backgroundColor: colorFor(study.composite_score) }}
        >
          <span className="text-4xl font-bold text-white">
            {study.composite_score}
          </span>
          <span className="text-[10px] text-white/80">/100</span>
        </div>
        <div className="flex-1 space-y-2 text-center sm:text-left">
          <h3
            className="text-lg font-semibold"
            style={{ color: recommendationColor(study.recommendation) }}
          >
            {study.recommendation}
          </h3>
          <p className="text-xs text-white/60">
            Confidence: <span className="text-white/80">{study.confidence_level}</span>
            {" · "}Data completeness:{" "}
            <span className="text-white/80">
              {Math.round(study.data_completeness * 100)}%
            </span>
            {" · "}Version <span className="text-white/80">{study.version_number}</span>
            {study.is_franchise ? " · Franchise weighting" : ""}
          </p>
          {study.narratives?.executiveSummary && (
            <p className="text-sm text-white/70 line-clamp-4">
              {study.narratives.executiveSummary}
            </p>
          )}
        </div>
      </div>

      {/* Dimension bars */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white/80">
          Dimension Breakdown
        </h3>
        {dimensions.map((d) => (
          <div key={d.key}>
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => (prev === d.key ? null : d.key))
              }
              className="w-full text-left"
            >
              <div className="flex items-center justify-between text-xs text-white/60 mb-1">
                <span>{d.label}</span>
                <span className="font-mono text-white/80">{d.score}/100</span>
              </div>
              <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${d.score}%`,
                    backgroundColor: colorFor(d.score),
                  }}
                />
              </div>
            </button>
            {expanded === d.key && d.detail && (
              <div className="mt-2 space-y-2 pl-2 border-l border-white/10">
                {Object.entries(d.detail).map(([k, dim]) => {
                  if (!dim) return null;
                  return (
                    <div key={k} className="text-xs">
                      <div className="flex items-center justify-between text-white/50">
                        <span>{k.replace(/([A-Z])/g, " $1").trim()}</span>
                        <span className="font-mono">{dim.score}/100</span>
                      </div>
                      <p className="text-white/60 mt-0.5">{dim.detail}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Flags panel */}
      {study.flags.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white/80">
            Flags — {criticalFlags.length} critical, {warningFlags.length}{" "}
            warning, {infoFlags.length} info
          </h3>
          {[...criticalFlags, ...warningFlags, ...infoFlags].map((f, i) => {
            const color =
              f.severity === "critical"
                ? "#dc2626"
                : f.severity === "warning"
                  ? "#d97706"
                  : "#2563eb";
            return (
              <div key={i} className="flex gap-3">
                <div
                  className="w-1 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="flex-1">
                  <div className="text-xs font-semibold" style={{ color }}>
                    {f.severity.toUpperCase()} · {f.dimension}
                  </div>
                  <p className="text-sm text-white/70 mt-0.5">{f.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (study.pdf_url) {
              window.open(`/api/storage/${study.pdf_url}`, "_blank");
            }
          }}
          disabled={!study.pdf_url}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40"
        >
          Download Full Report (PDF)
        </button>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
        >
          {generating ? "Regenerating…" : "Regenerate with Updated Data"}
        </button>
      </div>
    </div>
  );
}

// ─── Progress Overlay ──────────────────────────────────────────────────
// Phase 2 Gap B — same UX pattern as SBAGenerationProgress. Renders a
// branded progress card when the SSE stream is active. Each milestone
// ticks green as the pct advances past its threshold.

const PROGRESS_MILESTONES: Array<{ label: string; threshold: number }> = [
  { label: "Loading deal data", threshold: 5 },
  { label: "Extracting research intelligence", threshold: 15 },
  { label: "Analyzing market demand", threshold: 25 },
  { label: "Evaluating financial viability", threshold: 35 },
  { label: "Assessing readiness & location", threshold: 45 },
  { label: "Computing composite score", threshold: 55 },
  { label: "Writing consultant narratives", threshold: 65 },
  { label: "Rendering feasibility report", threshold: 85 },
  { label: "Saving results", threshold: 95 },
];

function FeasibilityProgressOverlay({
  step,
  pct,
}: {
  step: string;
  pct: number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 space-y-4">
      <div className="text-center">
        <div className="text-sm font-semibold uppercase tracking-wider text-blue-400">
          Buddy The Underwriter
        </div>
        <h2 className="mt-2 text-lg font-bold text-white">
          Running Feasibility Analysis
        </h2>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-white/70">{step}</span>
        <span className="font-mono text-white/50">{Math.round(pct)}%</span>
      </div>

      <div className="space-y-2">
        {PROGRESS_MILESTONES.map((m) => {
          const done = pct >= m.threshold + 15;
          const active = !done && pct >= m.threshold;
          return (
            <div key={m.label} className="flex items-center gap-2 text-xs">
              {done ? (
                <span className="text-emerald-400">✓</span>
              ) : active ? (
                <span className="animate-pulse text-blue-400">●</span>
              ) : (
                <span className="text-white/20">○</span>
              )}
              <span
                className={
                  pct >= m.threshold ? "text-white/70" : "text-white/30"
                }
              >
                {m.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-white/40">
        This typically takes 45–90 seconds
      </p>
    </div>
  );
}
