"use client";

import { useEffect, useState } from "react";
import {
  GlassShell,
  GlassPageHeader,
} from "@/components/layout";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DailyRow = {
  day: string;
  engine_version: string | null;
  auto_attached: number;
  routed_to_review: number;
  no_match: number;
  total: number;
  overrides: number;
};

type ConfusionCluster = {
  from_type: string | null;
  to_type: string | null;
  count: number;
  last_seen: string;
};

type IntakeMetricsData = {
  ok: true;
  summary: {
    total_match_events: number;
    auto_attached: number;
    routed_to_review: number;
    no_match: number;
    auto_attach_rate: number;
    override_count: number;
  };
  daily: DailyRow[];
  confusion_clusters: ConfusionCluster[];
};

// ── Atomic metrics types ──────────────────────────────────────────────────

type SlotMetricRow = {
  slot_key: string;
  slot_id: string | null;
  engine_version: string | null;
  effective_doc_type: string | null;
  required_doc_type: string | null;
  auto_attached: number;
  routed_to_review: number;
  no_match: number;
  total_attempts: number;
  precision_rate: number | null;
  friction_rate: number | null;
};

type DocTypeMetricRow = {
  doc_type: string;
  engine_version: string | null;
  auto_attached: number;
  routed_to_review: number;
  no_match: number;
  total_match_events: number;
  override_count: number;
  auto_attach_rate: number | null;
  override_rate: number | null;
};

type ConfidenceBucket = {
  confidence_bucket: string;
  classification_tier: string | null;
  schema_version: string | null;
  event_count: number;
};

type AtomicMetricsData = {
  slotMetrics: SlotMetricRow[];
  docTypeMetrics: DocTypeMetricRow[];
  confidenceDistribution: ConfidenceBucket[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDay(isoDay: string): string {
  try {
    const d = new Date(isoDay);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return isoDay;
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function IntakeMetricsClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<IntakeMetricsData | null>(null);
  const [atomicData, setAtomicData] = useState<AtomicMetricsData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const res = await fetch("/api/metrics/intake", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) {
          if (!json.ok) {
            setError(json.error || "Failed to fetch intake metrics");
          } else {
            setData(json as IntakeMetricsData);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Network error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Atomic metrics fetch (parallel, non-blocking) ───────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadAtomic() {
      try {
        const res = await fetch("/api/admin/intake/atomic-metrics", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setAtomicData({
            slotMetrics: json.slotMetrics,
            docTypeMetrics: json.docTypeMetrics,
            confidenceDistribution: json.confidenceDistribution,
          });
        }
      } catch {
        // Atomic metrics are best-effort — don't block main dashboard
      }
    }

    void loadAtomic();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Loading / Error states ────────────────────────────────────────────
  if (loading) {
    return (
      <GlassShell>
        <GlassPageHeader
          title="Intake Metrics"
          subtitle="Loading intake pipeline metrics..."
        />
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
        </div>
      </GlassShell>
    );
  }

  if (error || !data) {
    return (
      <GlassShell>
        <GlassPageHeader
          title="Intake Metrics"
          subtitle="Intake pipeline performance dashboard"
        />
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-6 text-red-300">
          {error || "No data available"}
        </div>
      </GlassShell>
    );
  }

  const { summary, daily, confusion_clusters } = data;

  // ── Prepare chart data (ascending order for LineChart) ────────────────
  const chartData = [...daily]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => ({
      ...r,
      dayLabel: formatDay(r.day),
    }));

  // ── Version breakdown ─────────────────────────────────────────────────
  const versionMap = new Map<
    string,
    { auto: number; review: number; noMatch: number; total: number }
  >();
  for (const row of daily) {
    const ver = row.engine_version ?? "unknown";
    const existing = versionMap.get(ver) ?? {
      auto: 0,
      review: 0,
      noMatch: 0,
      total: 0,
    };
    existing.auto += row.auto_attached;
    existing.review += row.routed_to_review;
    existing.noMatch += row.no_match;
    existing.total += row.total;
    versionMap.set(ver, existing);
  }

  // ── Confusion heatmap data ────────────────────────────────────────────
  const confusionData = confusion_clusters
    .filter((c) => c.from_type && c.to_type)
    .slice(0, 15)
    .map((c) => ({
      pair: `${c.from_type} -> ${c.to_type}`,
      count: c.count,
      last_seen: c.last_seen,
    }));

  // Compute review rate for summary
  const reviewRate =
    summary.total_match_events > 0
      ? summary.routed_to_review / summary.total_match_events
      : 0;

  return (
    <GlassShell>
      <GlassPageHeader
        title="Intake Metrics"
        subtitle="Auto-attach rates, review routing, and override confusion heatmap"
      />

      {/* ── Summary Cards ────────────────────────────────────────────── */}
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {/* Auto-attach rate */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-white/50">
            Auto-attach Rate
          </div>
          <div className="mt-2 text-3xl font-bold text-emerald-400">
            {pct(summary.auto_attach_rate)}
          </div>
          <div className="mt-1 text-xs text-white/40">
            {summary.auto_attached} / {summary.total_match_events} match events
          </div>
        </div>

        {/* Review rate */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-white/50">
            Review Rate
          </div>
          <div className="mt-2 text-3xl font-bold text-amber-400">
            {pct(reviewRate)}
          </div>
          <div className="mt-1 text-xs text-white/40">
            {summary.routed_to_review} routed to review
          </div>
        </div>

        {/* Override count */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-white/50">
            Override Count
          </div>
          <div className="mt-2 text-3xl font-bold text-red-400">
            {summary.override_count}
          </div>
          <div className="mt-1 text-xs text-white/40">
            manual classification overrides
          </div>
        </div>
      </div>

      {/* ── Daily Trend Chart ────────────────────────────────────────── */}
      <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white/80">
          Daily Match Trend (Last 30 Days)
        </h3>
        {chartData.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-white/40">
            No match events in the last 30 days
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis
                  dataKey="dayLabel"
                  stroke="#ffffff40"
                  tick={{ fill: "#ffffff60", fontSize: 11 }}
                />
                <YAxis
                  allowDecimals={false}
                  stroke="#ffffff40"
                  tick={{ fill: "#ffffff60", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e1e2e",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="auto_attached"
                  name="Auto-attached"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="routed_to_review"
                  name="Routed to Review"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="no_match"
                  name="No Match"
                  stroke="#9ca3af"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Version Breakdown ────────────────────────────────────────── */}
      {versionMap.size > 0 && (
        <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="mb-4 text-sm font-semibold text-white/80">
            Engine Version Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase text-white/40">
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Auto-attached</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2">No Match</th>
                  <th className="px-3 py-2">Auto-attach Rate</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(versionMap.entries()).map(([ver, stats]) => (
                  <tr
                    key={ver}
                    className="border-b border-white/5 text-white/70"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{ver}</td>
                    <td className="px-3 py-2">{stats.total}</td>
                    <td className="px-3 py-2 text-emerald-400">
                      {stats.auto}
                    </td>
                    <td className="px-3 py-2 text-amber-400">
                      {stats.review}
                    </td>
                    <td className="px-3 py-2 text-white/40">
                      {stats.noMatch}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {stats.total > 0
                        ? pct(stats.auto / stats.total)
                        : "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Confusion Heatmap ────────────────────────────────────────── */}
      <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white/80">
          Override Confusion Clusters
        </h3>
        {confusionData.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-white/40">
            No override events recorded
          </div>
        ) : (
          <div
            className="w-full"
            style={{ height: Math.max(200, confusionData.length * 36) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={confusionData}
                layout="vertical"
                margin={{ left: 160, right: 20, top: 5, bottom: 5 }}
              >
                <XAxis
                  type="number"
                  allowDecimals={false}
                  stroke="#ffffff40"
                  tick={{ fill: "#ffffff60", fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="pair"
                  width={150}
                  stroke="#ffffff40"
                  tick={{ fill: "#ffffff60", fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e1e2e",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Overrides"
                  fill="#f87171"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Atomic Metrics Section ─────────────────────────────────────── */}
      {atomicData && (
        <>
          {/* ── Slot Precision Table ─────────────────────────────────── */}
          <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="mb-4 text-sm font-semibold text-white/80">
              Slot Precision (per-slot attachment accuracy)
            </h3>
            {atomicData.slotMetrics.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-white/40">
                No slot metrics available
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs uppercase text-white/40">
                      <th className="px-3 py-2">Slot Key</th>
                      <th className="px-3 py-2">Engine</th>
                      <th className="px-3 py-2">Required Type</th>
                      <th className="px-3 py-2">Attached</th>
                      <th className="px-3 py-2">Review</th>
                      <th className="px-3 py-2">No Match</th>
                      <th className="px-3 py-2">Precision</th>
                      <th className="px-3 py-2">Friction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...atomicData.slotMetrics]
                      .sort(
                        (a, b) =>
                          (a.precision_rate ?? 0) - (b.precision_rate ?? 0),
                      )
                      .map((row, i) => (
                        <tr
                          key={`${row.slot_key}-${row.engine_version}-${i}`}
                          className="border-b border-white/5 text-white/70"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.slot_key}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.engine_version ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {row.required_doc_type ?? row.effective_doc_type ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-emerald-400">
                            {row.auto_attached}
                          </td>
                          <td className="px-3 py-2 text-amber-400">
                            {row.routed_to_review}
                          </td>
                          <td className="px-3 py-2 text-white/40">
                            {row.no_match}
                          </td>
                          <td
                            className={`px-3 py-2 font-medium ${
                              row.precision_rate == null
                                ? "text-white/40"
                                : row.precision_rate < 0.7
                                  ? "text-red-400"
                                  : row.precision_rate < 0.85
                                    ? "text-amber-400"
                                    : "text-emerald-400"
                            }`}
                          >
                            {row.precision_rate != null
                              ? pct(row.precision_rate)
                              : "—"}
                          </td>
                          <td
                            className={`px-3 py-2 ${
                              row.friction_rate != null && row.friction_rate > 0.1
                                ? "text-red-400"
                                : "text-white/40"
                            }`}
                          >
                            {row.friction_rate != null
                              ? pct(row.friction_rate)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Doc Type Performance Table ────────────────────────────── */}
          <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="mb-4 text-sm font-semibold text-white/80">
              Doc Type Performance
            </h3>
            {atomicData.docTypeMetrics.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-white/40">
                No doc type metrics available
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs uppercase text-white/40">
                      <th className="px-3 py-2">Doc Type</th>
                      <th className="px-3 py-2">Engine</th>
                      <th className="px-3 py-2">Attached</th>
                      <th className="px-3 py-2">Review</th>
                      <th className="px-3 py-2">Overrides</th>
                      <th className="px-3 py-2">Attach Rate</th>
                      <th className="px-3 py-2">Override Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...atomicData.docTypeMetrics]
                      .sort(
                        (a, b) =>
                          (b.override_rate ?? 0) - (a.override_rate ?? 0),
                      )
                      .map((row, i) => (
                        <tr
                          key={`${row.doc_type}-${row.engine_version}-${i}`}
                          className="border-b border-white/5 text-white/70"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.doc_type}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.engine_version ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-emerald-400">
                            {row.auto_attached}
                          </td>
                          <td className="px-3 py-2 text-amber-400">
                            {row.routed_to_review}
                          </td>
                          <td
                            className={`px-3 py-2 ${
                              row.override_count > 0
                                ? "text-red-400"
                                : "text-white/40"
                            }`}
                          >
                            {row.override_count}
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {row.auto_attach_rate != null
                              ? pct(row.auto_attach_rate)
                              : "—"}
                          </td>
                          <td
                            className={`px-3 py-2 font-medium ${
                              row.override_rate == null
                                ? "text-white/40"
                                : row.override_rate >= 0.1
                                  ? "text-red-400"
                                  : row.override_rate > 0
                                    ? "text-amber-400"
                                    : "text-emerald-400"
                            }`}
                          >
                            {row.override_rate != null
                              ? pct(row.override_rate)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Confidence Histogram ──────────────────────────────────── */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="mb-4 text-sm font-semibold text-white/80">
              Classification Confidence Distribution
            </h3>
            {atomicData.confidenceDistribution.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-white/40">
                No classification events available
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={atomicData.confidenceDistribution
                      .reduce(
                        (acc, row) => {
                          const existing = acc.find(
                            (a) => a.bucket === row.confidence_bucket,
                          );
                          if (existing) {
                            existing.count += row.event_count;
                            existing[row.classification_tier ?? "unknown"] =
                              (existing[
                                row.classification_tier ?? "unknown"
                              ] ?? 0) + row.event_count;
                          } else {
                            acc.push({
                              bucket: row.confidence_bucket,
                              count: row.event_count,
                              [row.classification_tier ?? "unknown"]:
                                row.event_count,
                            });
                          }
                          return acc;
                        },
                        [] as Array<Record<string, any>>,
                      )
                      .sort((a, b) =>
                        a.bucket.localeCompare(b.bucket),
                      )}
                    margin={{ left: 10, right: 10, top: 5, bottom: 5 }}
                  >
                    <XAxis
                      dataKey="bucket"
                      stroke="#ffffff40"
                      tick={{ fill: "#ffffff60", fontSize: 10 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="#ffffff40"
                      tick={{ fill: "#ffffff60", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e1e2e",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        color: "#fff",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="Classifications"
                      fill="#818cf8"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </GlassShell>
  );
}
