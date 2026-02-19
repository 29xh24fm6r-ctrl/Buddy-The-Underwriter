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

// ── Layer 1.5 — Top Leaks Command Center ─────────────────────────────────────

type SlotOverrideRow = {
  slot_key: string;
  slot_id: string | null;
  effective_doc_type: string | null;
  required_doc_type: string | null;
  engine_version: string | null;
  auto_attached: number;
  routed_to_review: number;
  total_attempts: number;
  precision_rate: number | null;
  friction_rate: number | null;
  override_count: number;
  override_rate: number;
};

type SlotReviewRow = {
  slot_key: string;
  slot_id: string | null;
  effective_doc_type: string | null;
  required_doc_type: string | null;
  engine_version: string | null;
  routed_to_review: number;
  total_attempts: number;
  review_rate: number | null;
};

type DocTypeReviewRow = {
  doc_type: string;
  engine_version: string | null;
  total_match_events: number;
  routed_to_review: number;
  review_rate: number | null;
};

type RegressionRow = {
  doc_type: string;
  engine_version: string;
  auto_attach_rate: number | null;
  prior_attach_rate: number | null;
  delta: number | null;
};

type AnomalyRow = {
  doc_type: string;
  engine_version: string | null;
  avg_confidence: number | null;
  sample_count: number;
  auto_attach_rate: number | null;
};

type TopLeaksData = {
  topSlotOverrides: SlotOverrideRow[];
  topSlotReview: SlotReviewRow[];
  topDocTypeReview: DocTypeReviewRow[];
  engineRegression: RegressionRow[];
  confidenceAnomalies: AnomalyRow[];
};

// ── Layer 2 — Identity Layer Coverage ────────────────────────────────────────

type IdentityCoverageRow = {
  doc_type: string;
  engine_version: string | null;
  total_events: number;
  resolved_count: number;
  resolution_rate: number | null;
};

type IdentityAmbiguityRow = {
  doc_type: string;
  total_events: number;
  ambiguous_count: number;
  ambiguity_rate: number | null;
};

type IdentityEnforcementRow = {
  doc_type: string;
  engine_version: string | null;
  enforcement_count: number;
};

type IdentityLayerData = {
  coverage: IdentityCoverageRow[];
  ambiguityHotspots: IdentityAmbiguityRow[];
  enforcementEvents: IdentityEnforcementRow[];
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
  const [topLeaksData, setTopLeaksData] = useState<TopLeaksData | null>(null);
  const [identityData, setIdentityData] = useState<IdentityLayerData | null>(null);

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

  // ── Top Leaks Command Center fetch (parallel, non-blocking) ───────────────
  useEffect(() => {
    let cancelled = false;

    async function loadTopLeaks() {
      try {
        const res = await fetch("/api/admin/intake/top-leaks", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setTopLeaksData({
            topSlotOverrides: json.topSlotOverrides,
            topSlotReview: json.topSlotReview,
            topDocTypeReview: json.topDocTypeReview,
            engineRegression: json.engineRegression,
            confidenceAnomalies: json.confidenceAnomalies,
          });
        }
      } catch {
        // Top leaks are best-effort — don't block main dashboard
      }
    }

    void loadTopLeaks();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Identity Layer Coverage fetch (parallel, non-blocking) ───────────────
  useEffect(() => {
    let cancelled = false;

    async function loadIdentity() {
      try {
        const res = await fetch("/api/admin/intake/identity", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setIdentityData({
            coverage: json.coverage,
            ambiguityHotspots: json.ambiguityHotspots,
            enforcementEvents: json.enforcementEvents ?? [],
          });
        }
      } catch {
        // Identity metrics are best-effort — don't block main dashboard
      }
    }

    void loadIdentity();
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

      {/* ── Intake Command Center (Layer 1.5) ─────────────────────────── */}
      {topLeaksData && (
        <>
          <div className="mb-2 mt-8 text-sm font-semibold text-white/80 uppercase tracking-widest">
            Intake Command Center
          </div>

          {/* Panel 1: Top Slot Overrides */}
          <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-xs font-semibold text-white/70 uppercase tracking-wider">
              Top Slot Overrides (by override rate)
            </div>
            {topLeaksData.topSlotOverrides.length === 0 ? (
              <p className="text-xs text-white/40 italic">No slots above minimum threshold yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50">
                      <th className="py-1 pr-3 text-left font-medium">Slot Key</th>
                      <th className="py-1 pr-3 text-left font-medium">Doc Type</th>
                      <th className="py-1 pr-3 text-left font-medium">Engine</th>
                      <th className="py-1 pr-3 text-right font-medium">Attempts</th>
                      <th className="py-1 pr-3 text-right font-medium">Overrides</th>
                      <th className="py-1 pr-3 text-right font-medium">Override Rate</th>
                      <th className="py-1 text-right font-medium">Precision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...topLeaksData.topSlotOverrides]
                      .sort((a, b) => b.override_rate - a.override_rate)
                      .slice(0, 10)
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.slot_key}</td>
                          <td className="py-1 pr-3 text-white/60">{row.effective_doc_type ?? "—"}</td>
                          <td className="py-1 pr-3 text-white/50">{row.engine_version ?? "—"}</td>
                          <td className="py-1 pr-3 text-right text-white/70">{row.total_attempts}</td>
                          <td className="py-1 pr-3 text-right">
                            <span className={row.override_count > 0 ? "text-red-400" : "text-white/40"}>
                              {row.override_count}
                            </span>
                          </td>
                          <td className="py-1 pr-3 text-right">
                            <span className={
                              row.override_rate > 0.15 ? "text-red-400 font-semibold"
                              : row.override_rate > 0.05 ? "text-amber-400"
                              : "text-emerald-400"
                            }>
                              {pct(row.override_rate)}
                            </span>
                          </td>
                          <td className="py-1 text-right text-white/60">
                            {row.precision_rate != null ? pct(row.precision_rate) : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel 2: Top Slot Review Friction */}
          <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-xs font-semibold text-white/70 uppercase tracking-wider">
              Top Slot Review Friction (by review rate)
            </div>
            {topLeaksData.topSlotReview.length === 0 ? (
              <p className="text-xs text-white/40 italic">No slots above minimum threshold yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50">
                      <th className="py-1 pr-3 text-left font-medium">Slot Key</th>
                      <th className="py-1 pr-3 text-left font-medium">Doc Type</th>
                      <th className="py-1 pr-3 text-left font-medium">Engine</th>
                      <th className="py-1 pr-3 text-right font-medium">Attempts</th>
                      <th className="py-1 pr-3 text-right font-medium">Reviewed</th>
                      <th className="py-1 text-right font-medium">Review Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...topLeaksData.topSlotReview]
                      .sort((a, b) => (b.review_rate ?? 0) - (a.review_rate ?? 0))
                      .slice(0, 10)
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.slot_key}</td>
                          <td className="py-1 pr-3 text-white/60">{row.effective_doc_type ?? "—"}</td>
                          <td className="py-1 pr-3 text-white/50">{row.engine_version ?? "—"}</td>
                          <td className="py-1 pr-3 text-right text-white/70">{row.total_attempts}</td>
                          <td className="py-1 pr-3 text-right text-white/60">{row.routed_to_review}</td>
                          <td className="py-1 text-right">
                            <span className={
                              (row.review_rate ?? 0) > 0.25 ? "text-red-400 font-semibold"
                              : (row.review_rate ?? 0) > 0.10 ? "text-amber-400"
                              : "text-emerald-400"
                            }>
                              {row.review_rate != null ? pct(row.review_rate) : "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel 3: Top Doc Type Review */}
          <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-xs font-semibold text-white/70 uppercase tracking-wider">
              Top Doc Type Review Friction
            </div>
            {topLeaksData.topDocTypeReview.length === 0 ? (
              <p className="text-xs text-white/40 italic">No doc types above minimum threshold yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50">
                      <th className="py-1 pr-3 text-left font-medium">Doc Type</th>
                      <th className="py-1 pr-3 text-left font-medium">Engine</th>
                      <th className="py-1 pr-3 text-right font-medium">Total</th>
                      <th className="py-1 pr-3 text-right font-medium">Reviewed</th>
                      <th className="py-1 text-right font-medium">Review Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...topLeaksData.topDocTypeReview]
                      .sort((a, b) => (b.review_rate ?? 0) - (a.review_rate ?? 0))
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.doc_type}</td>
                          <td className="py-1 pr-3 text-white/50">{row.engine_version ?? "—"}</td>
                          <td className="py-1 pr-3 text-right text-white/70">{row.total_match_events}</td>
                          <td className="py-1 pr-3 text-right text-white/60">{row.routed_to_review}</td>
                          <td className="py-1 text-right">
                            <span className={
                              (row.review_rate ?? 0) > 0.30 ? "text-red-400 font-semibold"
                              : (row.review_rate ?? 0) > 0.15 ? "text-amber-400"
                              : "text-emerald-400"
                            }>
                              {row.review_rate != null ? pct(row.review_rate) : "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel 4: Engine Version Regression */}
          <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-xs font-semibold text-white/70 uppercase tracking-wider">
              Engine Version Regression Delta
            </div>
            {topLeaksData.engineRegression.length === 0 ? (
              <p className="text-xs text-white/40 italic">No multi-version data available yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50">
                      <th className="py-1 pr-3 text-left font-medium">Doc Type</th>
                      <th className="py-1 pr-3 text-left font-medium">Engine</th>
                      <th className="py-1 pr-3 text-right font-medium">Current Rate</th>
                      <th className="py-1 pr-3 text-right font-medium">Prior Rate</th>
                      <th className="py-1 text-right font-medium">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...topLeaksData.engineRegression]
                      .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.doc_type}</td>
                          <td className="py-1 pr-3 text-white/50">{row.engine_version}</td>
                          <td className="py-1 pr-3 text-right text-white/70">
                            {row.auto_attach_rate != null ? pct(row.auto_attach_rate) : "—"}
                          </td>
                          <td className="py-1 pr-3 text-right text-white/50">
                            {row.prior_attach_rate != null ? pct(row.prior_attach_rate) : "—"}
                          </td>
                          <td className="py-1 text-right">
                            <span className={
                              (row.delta ?? 0) < -0.05 ? "text-red-400 font-semibold"
                              : (row.delta ?? 0) < 0 ? "text-amber-400"
                              : "text-emerald-400"
                            }>
                              {row.delta != null ? `${row.delta > 0 ? "+" : ""}${pct(row.delta)}` : "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel 5: Confidence Anomalies */}
          <div className="mb-8 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-xs font-semibold text-white/70 uppercase tracking-wider">
              Confidence Anomalies (high confidence → low attach)
            </div>
            {topLeaksData.confidenceAnomalies.length === 0 ? (
              <p className="text-xs text-white/40 italic">No confidence anomalies detected.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50">
                      <th className="py-1 pr-3 text-left font-medium">Doc Type</th>
                      <th className="py-1 pr-3 text-left font-medium">Engine</th>
                      <th className="py-1 pr-3 text-right font-medium">Avg Confidence</th>
                      <th className="py-1 pr-3 text-right font-medium">Samples</th>
                      <th className="py-1 text-right font-medium">Auto-Attach Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...topLeaksData.confidenceAnomalies]
                      .sort((a, b) => (b.avg_confidence ?? 0) - (a.avg_confidence ?? 0))
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.doc_type}</td>
                          <td className="py-1 pr-3 text-white/50">{row.engine_version ?? "—"}</td>
                          <td className="py-1 pr-3 text-right text-amber-300">
                            {row.avg_confidence != null ? pct(row.avg_confidence) : "—"}
                          </td>
                          <td className="py-1 pr-3 text-right text-white/50">{row.sample_count}</td>
                          <td className="py-1 text-right text-red-400 font-semibold">
                            {row.auto_attach_rate != null ? pct(row.auto_attach_rate) : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Identity Layer Coverage (Layer 2 v1.0) ─────────────────────── */}
      {identityData && (
        <>
          <div className="mt-10 border-t border-white/10 pt-8">
            <h2 className="mb-6 text-lg font-semibold text-white/80">
              Identity Layer Coverage
            </h2>

            {/* Panel 1: Resolution Rate by Doc Type */}
            {identityData.coverage.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-3 text-sm font-medium text-white/60">
                  Resolution Rate by Doc Type
                </h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-white/40">
                      <th className="pb-2 pr-3">Doc Type</th>
                      <th className="pb-2 pr-3 text-right">Total Events</th>
                      <th className="pb-2 pr-3 text-right">Resolved</th>
                      <th className="pb-2 text-right">Resolution Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...identityData.coverage]
                      .sort((a, b) => (b.resolution_rate ?? 0) - (a.resolution_rate ?? 0))
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.doc_type}</td>
                          <td className="py-1 pr-3 text-right text-white/50">{row.total_events}</td>
                          <td className="py-1 pr-3 text-right text-white/50">{row.resolved_count}</td>
                          <td className={`py-1 text-right font-semibold ${
                            row.resolution_rate != null && row.resolution_rate < 0.50
                              ? "text-amber-400"
                              : "text-emerald-400"
                          }`}>
                            {row.resolution_rate != null ? pct(row.resolution_rate) : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Panel 2: Ambiguity Hotspots */}
            {identityData.ambiguityHotspots.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-3 text-sm font-medium text-white/60">
                  Ambiguity Hotspots
                </h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-white/40">
                      <th className="pb-2 pr-3">Doc Type</th>
                      <th className="pb-2 pr-3 text-right">Events</th>
                      <th className="pb-2 pr-3 text-right">Ambiguous</th>
                      <th className="pb-2 text-right">Ambiguity Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...identityData.ambiguityHotspots]
                      .sort((a, b) => (b.ambiguity_rate ?? 0) - (a.ambiguity_rate ?? 0))
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.doc_type}</td>
                          <td className="py-1 pr-3 text-right text-white/50">{row.total_events}</td>
                          <td className="py-1 pr-3 text-right text-white/50">{row.ambiguous_count}</td>
                          <td className={`py-1 text-right font-semibold ${
                            row.ambiguity_rate != null && row.ambiguity_rate > 0.20
                              ? "text-red-400"
                              : "text-white/70"
                          }`}>
                            {row.ambiguity_rate != null ? pct(row.ambiguity_rate) : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Panel 3: Identity Enforcement Activity (Layer 2.1) */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-medium text-white/60">
                Identity Enforcement Activity
              </h3>
              {identityData.enforcementEvents.length === 0 ? (
                <p className="text-xs text-white/40 italic">
                  No enforcement events recorded (ENABLE_ENTITY_GRAPH may be off)
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-white/40">
                      <th className="pb-2 pr-3">Doc Type</th>
                      <th className="pb-2 pr-3">Engine</th>
                      <th className="pb-2 text-right">Enforcement Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...identityData.enforcementEvents]
                      .sort((a, b) => b.enforcement_count - a.enforcement_count)
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.doc_type}</td>
                          <td className="py-1 pr-3 text-white/50">{row.engine_version ?? "—"}</td>
                          <td className={`py-1 text-right font-semibold ${
                            row.enforcement_count > 15
                              ? "text-red-400"
                              : row.enforcement_count > 5
                                ? "text-amber-400"
                                : "text-emerald-400"
                          }`}>
                            {row.enforcement_count}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </GlassShell>
  );
}
