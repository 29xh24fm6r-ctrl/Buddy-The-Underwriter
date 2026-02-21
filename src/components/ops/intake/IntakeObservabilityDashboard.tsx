"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
  GlassStatCard,
} from "@/components/layout/GlassShell";
import {
  LineChart,
  BarChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FunnelRow = {
  day: string;
  uploaded: number;
  classified: number;
  gate_held: number;
  confirmed: number;
  submitted: number;
  median_upload_to_classify_s: number | null;
  median_classify_to_confirm_s: number | null;
};

type QualityRow = {
  day: string;
  total_docs: number;
  passed: number;
  failed_low_text: number;
  failed_low_confidence: number;
  failed_ocr_error: number;
  not_evaluated: number;
  pass_rate: number | null;
};

type SegmentationRow = {
  day: string;
  detected: number;
  physically_split: number;
  detected_not_split: number;
  total_children_created: number;
  avg_segments_per_doc: number | null;
};

type OverrideDailyRow = {
  day: string;
  override_source: string;
  override_count: number;
  avg_confidence_at_time: number | null;
  dominant_classifier_source: string | null;
};

type OverridePatternRow = {
  from_type: string | null;
  to_type: string | null;
  override_source: string;
  pattern_count: number;
  avg_confidence: number | null;
  dominant_classifier: string | null;
  first_seen: string | null;
  last_seen: string | null;
};

type KPIs = {
  total_uploads: number;
  total_classified: number;
  gate_held_pct: number | null;
  override_rate: number | null;
  quality_pass_pct: number | null;
  median_classify_time_s: number | null;
};

type DateRange = 7 | 14 | 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOLTIP_STYLE = {
  backgroundColor: "#1e1e2e",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#fff",
};

const AXIS_TICK = { fill: "#ffffff60", fontSize: 11 };

function formatDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "--";
  return `${n.toFixed(1)}%`;
}

function filterByRange<T extends { day: string }>(
  rows: T[],
  days: DateRange,
): T[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return rows.filter((r) => r.day >= cutoffStr);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function IntakeObservabilityDashboard() {
  const [range, setRange] = useState<DateRange>(14);
  const [loading, setLoading] = useState(true);

  // Data
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [quality, setQuality] = useState<QualityRow[]>([]);
  const [segmentation, setSegmentation] = useState<SegmentationRow[]>([]);
  const [overrideDaily, setOverrideDaily] = useState<OverrideDailyRow[]>([]);
  const [topPatterns, setTopPatterns] = useState<OverridePatternRow[]>([]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [funnelRes, qualityRes, segRes, overrideRes, summaryRes] =
        await Promise.all([
          fetch("/api/ops/intake/funnel", { cache: "no-store" }),
          fetch("/api/ops/intake/quality", { cache: "no-store" }),
          fetch("/api/ops/intake/segmentation", { cache: "no-store" }),
          fetch("/api/ops/intake/overrides", { cache: "no-store" }),
          fetch("/api/ops/intake/summary", { cache: "no-store" }),
        ]);

      const [funnelJson, qualityJson, segJson, overrideJson, summaryJson] =
        await Promise.all([
          funnelRes.json(),
          qualityRes.json(),
          segRes.json(),
          overrideRes.json(),
          summaryRes.json(),
        ]);

      if (funnelJson.ok) setFunnel(funnelJson.funnel ?? []);
      if (qualityJson.ok) setQuality(qualityJson.quality ?? []);
      if (segJson.ok) setSegmentation(segJson.segmentation ?? []);
      if (overrideJson.ok) {
        setOverrideDaily(overrideJson.daily ?? []);
        setTopPatterns(overrideJson.topPatterns ?? []);
      }
      if (summaryJson.ok) setKpis(summaryJson.kpis ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Filtered data
  const filteredFunnel = useMemo(
    () =>
      filterByRange(funnel, range)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ ...r, dayLabel: formatDay(r.day) })),
    [funnel, range],
  );

  const filteredQuality = useMemo(
    () =>
      filterByRange(quality, range)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({
          ...r,
          dayLabel: formatDay(r.day),
          pass_rate_pct: r.pass_rate != null ? +(r.pass_rate * 100).toFixed(1) : null,
        })),
    [quality, range],
  );

  const filteredSegmentation = useMemo(
    () =>
      filterByRange(segmentation, range)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ ...r, dayLabel: formatDay(r.day) })),
    [segmentation, range],
  );

  // Pivot overrides by source per day
  const filteredOverrideChart = useMemo(() => {
    const filtered = filterByRange(overrideDaily, range);
    const byDay: Record<string, Record<string, number>> = {};
    for (const r of filtered) {
      if (!byDay[r.day]) byDay[r.day] = {};
      byDay[r.day][r.override_source] =
        (byDay[r.day][r.override_source] ?? 0) + r.override_count;
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, sources]) => ({
        dayLabel: formatDay(day),
        intake_review_table: sources.intake_review_table ?? 0,
        cockpit: sources.cockpit ?? 0,
        unknown: sources.unknown ?? 0,
      }));
  }, [overrideDaily, range]);

  // Worst quality days
  const worstQualityDays = useMemo(
    () =>
      [...filterByRange(quality, range)]
        .filter((r) => r.total_docs > 0)
        .sort(
          (a, b) =>
            (a.passed / Math.max(a.total_docs, 1)) -
            (b.passed / Math.max(b.total_docs, 1)),
        )
        .slice(0, 10),
    [quality, range],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <GlassShell>
      <GlassPageHeader
        title="Intake Observability"
        subtitle="Funnel, quality, and override metrics"
      />

      {/* Date range chips */}
      <div className="mb-6 flex gap-2">
        {([7, 14, 30] as const).map((d) => (
          <button
            key={d}
            onClick={() => setRange(d)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
              range === d
                ? "bg-white/15 text-white"
                : "bg-white/[0.03] text-white/50 hover:bg-white/[0.06]"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-white/40">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          <span className="ml-3 text-sm">Loading metrics...</span>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* KPI Tiles */}
          <div className="mb-8 grid gap-4 md:grid-cols-4">
            <GlassStatCard
              label="Total Uploads"
              value={kpis?.total_uploads ?? 0}
            />
            <GlassStatCard
              label="Gate Held %"
              value={pct(kpis?.gate_held_pct)}
            />
            <GlassStatCard
              label="Override Rate %"
              value={pct(kpis?.override_rate)}
            />
            <GlassStatCard
              label="Quality Pass %"
              value={pct(kpis?.quality_pass_pct)}
            />
          </div>

          {/* Chart 1: Intake Funnel */}
          <GlassPanel header="Intake Funnel (Daily)">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredFunnel}>
                  <XAxis
                    dataKey="dayLabel"
                    stroke="#ffffff40"
                    tick={AXIS_TICK}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="#ffffff40"
                    tick={AXIS_TICK}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, color: "#ffffff80" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="uploaded"
                    stroke="#34d399"
                    strokeWidth={2}
                    dot={false}
                    name="Uploaded"
                  />
                  <Line
                    type="monotone"
                    dataKey="classified"
                    stroke="#818cf8"
                    strokeWidth={2}
                    dot={false}
                    name="Classified"
                  />
                  <Line
                    type="monotone"
                    dataKey="gate_held"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                    name="Gate Held"
                  />
                  <Line
                    type="monotone"
                    dataKey="confirmed"
                    stroke="#f472b6"
                    strokeWidth={2}
                    dot={false}
                    name="Confirmed"
                  />
                  <Line
                    type="monotone"
                    dataKey="submitted"
                    stroke="#9ca3af"
                    strokeWidth={2}
                    dot={false}
                    name="Submitted"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>

          {/* Chart 2: Quality Pass Rate */}
          <GlassPanel header="Quality Pass Rate (Daily)">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredQuality}>
                  <XAxis
                    dataKey="dayLabel"
                    stroke="#ffffff40"
                    tick={AXIS_TICK}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="#ffffff40"
                    tick={AXIS_TICK}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: unknown) => [`${v}%`, "Pass Rate"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="pass_rate_pct"
                    stroke="#34d399"
                    strokeWidth={2}
                    dot={false}
                    name="Pass Rate"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>

          {/* Chart 3: Segmentation Volume */}
          <GlassPanel header="Segmentation Volume (Daily)">
            {filteredSegmentation.length === 0 ? (
              <p className="py-8 text-center text-sm text-white/30">
                No segmentation events in selected range
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredSegmentation}>
                    <XAxis
                      dataKey="dayLabel"
                      stroke="#ffffff40"
                      tick={AXIS_TICK}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="#ffffff40"
                      tick={AXIS_TICK}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, color: "#ffffff80" }}
                    />
                    <Bar
                      dataKey="physically_split"
                      name="Physically Split"
                      fill="#34d399"
                      stackId="a"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="detected_not_split"
                      name="Detected (no split)"
                      fill="#fbbf24"
                      stackId="a"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          {/* Chart 4: Overrides by Source */}
          <GlassPanel header="Overrides by Source (Daily)">
            {filteredOverrideChart.length === 0 ? (
              <p className="py-8 text-center text-sm text-white/30">
                No override events in selected range
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredOverrideChart}>
                    <XAxis
                      dataKey="dayLabel"
                      stroke="#ffffff40"
                      tick={AXIS_TICK}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="#ffffff40"
                      tick={AXIS_TICK}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, color: "#ffffff80" }}
                    />
                    <Bar
                      dataKey="intake_review_table"
                      name="Intake Review"
                      fill="#818cf8"
                      stackId="a"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="cockpit"
                      name="Cockpit"
                      fill="#fbbf24"
                      stackId="a"
                    />
                    <Bar
                      dataKey="unknown"
                      name="Unknown"
                      fill="#9ca3af"
                      stackId="a"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          {/* Table 1: Top Override Patterns */}
          <GlassPanel header="Top Override Patterns (30d)">
            {topPatterns.length === 0 ? (
              <p className="py-8 text-center text-sm text-white/30">
                No override patterns in the last 30 days
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-white/40">
                      <th className="px-3 py-2">From Type</th>
                      <th className="px-3 py-2">To Type</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2 text-right">Count</th>
                      <th className="px-3 py-2 text-right">Avg Conf</th>
                      <th className="px-3 py-2">Classifier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPatterns.slice(0, 20).map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-white/5 text-white/70 hover:bg-white/[0.02]"
                      >
                        <td className="px-3 py-2 font-mono text-red-300">
                          {row.from_type ?? "--"}
                        </td>
                        <td className="px-3 py-2 font-mono text-emerald-300">
                          {row.to_type ?? "--"}
                        </td>
                        <td className="px-3 py-2">{row.override_source}</td>
                        <td className="px-3 py-2 text-right font-mono text-white">
                          {row.pattern_count}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.avg_confidence != null
                            ? row.avg_confidence.toFixed(2)
                            : "--"}
                        </td>
                        <td className="px-3 py-2 text-white/50">
                          {row.dominant_classifier ?? "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassPanel>

          {/* Table 2: Worst Quality Days */}
          <GlassPanel header="Quality Breakdown (Worst Days)">
            {worstQualityDays.length === 0 ? (
              <p className="py-8 text-center text-sm text-white/30">
                No quality data in selected range
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-white/40">
                      <th className="px-3 py-2">Day</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Passed</th>
                      <th className="px-3 py-2 text-right">Low Text</th>
                      <th className="px-3 py-2 text-right">Low Conf</th>
                      <th className="px-3 py-2 text-right">OCR Error</th>
                      <th className="px-3 py-2 text-right">Not Eval</th>
                      <th className="px-3 py-2 text-right">Pass Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worstQualityDays.map((row, i) => {
                      const failTotal =
                        row.failed_low_text +
                        row.failed_low_confidence +
                        row.failed_ocr_error;
                      return (
                        <tr
                          key={i}
                          className="border-b border-white/5 text-white/70 hover:bg-white/[0.02]"
                        >
                          <td className="px-3 py-2">{formatDay(row.day)}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {row.total_docs}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-400">
                            {row.passed}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-amber-400">
                            {row.failed_low_text || "--"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-amber-400">
                            {row.failed_low_confidence || "--"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-red-400">
                            {row.failed_ocr_error || "--"}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              row.not_evaluated > 0
                                ? "text-red-400"
                                : "text-white/30"
                            }`}
                          >
                            {row.not_evaluated || "--"}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              failTotal > 0
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }`}
                          >
                            {row.pass_rate != null
                              ? `${(row.pass_rate * 100).toFixed(1)}%`
                              : "--"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </GlassPanel>
        </>
      )}
    </GlassShell>
  );
}
