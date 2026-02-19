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

type IdentityPrecisionRow = {
  doc_type: string;
  engine_version: string | null;
  high_confidence_events: number;
  precision_auto_attached: number;
};

type IdentitySlotBindingRow = {
  doc_type: string;
  total_slots: number;
  bound_slots: number;
  unbound_slots: number;
  binding_rate_pct: number | null;
};

type IdentityRepairRow = {
  entity_kind: string | null;
  auto_bound: number;
  synthetic_bound: number;
  review_required: number;
  synthetic_created: number;
};

type IdentityIntelligenceRow = {
  entity_kind: string | null;
  synthetics_refined: number;
  relationships_inferred: number;
  manual_confirmations: number;
};

type IdentityLayerData = {
  coverage: IdentityCoverageRow[];
  ambiguityHotspots: IdentityAmbiguityRow[];
  enforcementEvents: IdentityEnforcementRow[];
  precisionMetrics: IdentityPrecisionRow[];
  slotBindingCoverage: IdentitySlotBindingRow[];
  repairMetrics: IdentityRepairRow[];
  intelligenceMetrics: IdentityIntelligenceRow[];
};

// ── Phase A — Segmentation Health ────────────────────────────────────────────

type SegmentationMetricRow = {
  document_type: string | null;
  parent_docs_split: number;
  total_segments_created: number;
  split_failures: number;
  avg_children: number | null;
};

// ── Phase C — Intake Governance ───────────────────────────────────────────────

type WorkerHealthRow = {
  worker_id: string | null;
  worker_type: string | null;
  status: string | null;
  last_heartbeat_at: string | null;
  seconds_since_heartbeat: number | null;
  consecutive_failures: number | null;
  health_color: string | null;
};

type QueueLatencyRow = {
  job_type: string | null;
  queued_count: number | null;
  max_queue_age_seconds: number | null;
  health_color: string | null;
};

type OcrFailuresRow = {
  failed_count_24h: number;
  empty_ocr_count_24h: number;
  total_24h: number;
  health_color: string | null;
};

type IntakeGovernanceData = {
  workerHealth: WorkerHealthRow[];
  queueLatency: QueueLatencyRow[];
  ocrFailures: OcrFailuresRow;
};

// ── Phase D — Signal Intelligence ────────────────────────────────────────────

type SignalStrengthRow = {
  effective_doc_type: string | null;
  total_docs: number | null;
  avg_confidence: number | null;
  min_confidence: number | null;
  max_confidence: number | null;
  confidence_stddev: number | null;
  low_confidence_count: number | null;
  health_color: string | null;
};

type ClassifierSourceMixRow = {
  effective_doc_type: string | null;
  match_source: string | null;
  doc_count: number | null;
  fraction_within_type: number | null;
  avg_confidence: number | null;
};

type SegmentationImpactRow = {
  document_class: string | null;
  doc_count: number | null;
  avg_confidence: number | null;
  avg_classification_seconds: number | null;
  manual_override_rate: number | null;
};

type EntityBindingRow = {
  [key: string]: unknown;
};

type OverrideCorrelationRow = {
  effective_doc_type: string | null;
  total_docs: number | null;
  manual_override_count: number | null;
  recent_manual_count: number | null;
  manual_override_rate: number | null;
  avg_confidence: number | null;
  confidence_stddev: number | null;
  health_color: string | null;
};

type IntakeSignalData = {
  signalStrength: SignalStrengthRow[];
  classifierSourceMix: ClassifierSourceMixRow[];
  segmentationImpact: SegmentationImpactRow[];
  entityBindingCoverage: EntityBindingRow[];
  overrideSignalCorrelation: OverrideCorrelationRow[];
};

// ── Phase B — Override Intelligence ──────────────────────────────────────────

type OverrideClusterRow = {
  from_type: string | null;
  to_type: string | null;
  override_count: number;
  avg_confidence_at_time: number | null;
  dominant_classifier_source: string | null;
  dominant_confidence_bucket: string | null;
  classification_version_range: string | null;
  segmentation_presence_ratio: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type OverrideDriftRow = {
  week_start: string | null;
  from_type: string | null;
  to_type: string | null;
  classifier_source: string | null;
  classification_version: string | null;
  weekly_count: number;
  prev_week_count: number | null;
  delta: number;
};

type OverrideIntelligenceData = {
  clusters: OverrideClusterRow[];
  drift: OverrideDriftRow[];
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
  const [segmentationData, setSegmentationData] = useState<SegmentationMetricRow[] | null>(null);
  const [overrideIntelligence, setOverrideIntelligence] = useState<OverrideIntelligenceData | null>(null);
  const [intakeGovernance, setIntakeGovernance] = useState<IntakeGovernanceData | null>(null);
  const [intakeSignal, setIntakeSignal] = useState<IntakeSignalData | null>(null);

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
            precisionMetrics: json.precisionMetrics ?? [],
            slotBindingCoverage: json.slotBindingCoverage ?? [],
            repairMetrics: json.repairMetrics ?? [],
            intelligenceMetrics: json.intelligenceMetrics ?? [],
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

  // ── Segmentation Health fetch (parallel, non-blocking) ───────────────
  useEffect(() => {
    let cancelled = false;

    async function loadSegmentation() {
      try {
        const res = await fetch("/api/admin/intake/segmentation", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setSegmentationData(json.segmentationMetrics);
        }
      } catch {
        // Segmentation metrics are best-effort — don't block main dashboard
      }
    }

    void loadSegmentation();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Override Intelligence fetch (parallel, non-blocking) ─────────────
  useEffect(() => {
    let cancelled = false;

    async function loadOverrideIntelligence() {
      try {
        const res = await fetch("/api/admin/intake/override", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setOverrideIntelligence({
            clusters: json.clusters ?? [],
            drift: json.drift ?? [],
          });
        }
      } catch {
        // Override intelligence is best-effort — don't block main dashboard
      }
    }

    void loadOverrideIntelligence();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Intake Governance fetch (parallel, non-blocking) ─────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadIntakeGovernance() {
      try {
        const res = await fetch("/api/admin/intake/reliability", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setIntakeGovernance({
            workerHealth: json.workerHealth ?? [],
            queueLatency: json.queueLatency ?? [],
            ocrFailures: json.ocrFailures ?? {
              failed_count_24h: 0,
              empty_ocr_count_24h: 0,
              total_24h: 0,
              health_color: null,
            },
          });
        }
      } catch {
        // Governance metrics are best-effort — don't block main dashboard
      }
    }

    void loadIntakeGovernance();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Intake Signal Intelligence fetch (parallel, non-blocking) ────────
  useEffect(() => {
    let cancelled = false;

    async function loadIntakeSignal() {
      try {
        const res = await fetch("/api/admin/intake/signal", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setIntakeSignal({
            signalStrength: json.signalStrength ?? [],
            classifierSourceMix: json.classifierSourceMix ?? [],
            segmentationImpact: json.segmentationImpact ?? [],
            entityBindingCoverage: json.entityBindingCoverage ?? [],
            overrideSignalCorrelation: json.overrideSignalCorrelation ?? [],
          });
        }
      } catch {
        // Signal intelligence is best-effort — don't block main dashboard
      }
    }

    void loadIntakeSignal();
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

            {/* Panel 4: Identity Precision Impact (Layer 2.2) */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-medium text-white/60">
                Identity Precision Impact
              </h3>
              {identityData.precisionMetrics.length === 0 ? (
                <p className="text-xs text-white/40 italic">
                  No precision events recorded (ENABLE_ENTITY_PRECISION may be off)
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-white/40">
                      <th className="pb-2 pr-3">Doc Type</th>
                      <th className="pb-2 pr-3">Engine</th>
                      <th className="pb-2 pr-3 text-right">High-Conf Events</th>
                      <th className="pb-2 text-right">Precision Auto-Attached</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...identityData.precisionMetrics]
                      .sort((a, b) => b.high_confidence_events - a.high_confidence_events)
                      .map((row, i) => {
                        const precisionRate =
                          row.high_confidence_events > 0
                            ? row.precision_auto_attached / row.high_confidence_events
                            : null;
                        return (
                          <tr key={i} className="border-b border-white/5">
                            <td className="py-1 pr-3 font-mono text-white/90">{row.doc_type}</td>
                            <td className="py-1 pr-3 text-white/50">{row.engine_version ?? "—"}</td>
                            <td className="py-1 pr-3 text-right text-white/60">
                              {row.high_confidence_events}
                            </td>
                            <td className={`py-1 text-right font-semibold ${
                              precisionRate != null && precisionRate < 0.60
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }`}>
                              {row.precision_auto_attached}
                              {precisionRate != null && (
                                <span className="ml-1 font-normal text-white/40">
                                  ({pct(precisionRate)})
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Panel 5: Slot Entity Binding Coverage (Layer 2.3) */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-medium text-white/60">
                Slot Entity Binding Coverage
              </h3>
              {identityData.slotBindingCoverage.length === 0 ? (
                <p className="text-xs text-white/40 italic">
                  No entity-scoped slots found
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-white/40">
                      <th className="pb-2 pr-3">Doc Type</th>
                      <th className="pb-2 pr-3 text-right">Bound</th>
                      <th className="pb-2 pr-3 text-right">Unbound</th>
                      <th className="pb-2 pr-3 text-right">Total</th>
                      <th className="pb-2 text-right">Binding Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...identityData.slotBindingCoverage]
                      .sort((a, b) => b.unbound_slots - a.unbound_slots)
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">{row.doc_type}</td>
                          <td className="py-1 pr-3 text-right text-emerald-400">{row.bound_slots}</td>
                          <td className={`py-1 pr-3 text-right ${
                            row.unbound_slots > 0 ? "text-amber-400" : "text-white/40"
                          }`}>
                            {row.unbound_slots}
                          </td>
                          <td className="py-1 pr-3 text-right text-white/50">{row.total_slots}</td>
                          <td className={`py-1 text-right font-semibold ${
                            row.binding_rate_pct != null && row.binding_rate_pct < 50
                              ? "text-red-400"
                              : row.binding_rate_pct != null && row.binding_rate_pct < 90
                                ? "text-amber-400"
                                : "text-emerald-400"
                          }`}>
                            {row.binding_rate_pct != null ? `${row.binding_rate_pct}%` : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Panel 6: Entity Binding Integrity (Layer 2.4) */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-medium text-white/60">
                Entity Binding Integrity
              </h3>
              {identityData.repairMetrics.length === 0 ? (
                <p className="text-xs text-white/40 italic">
                  No repair events yet (runs after first deal with ENABLE_ENTITY_GRAPH=true)
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-white/40">
                      <th className="pb-2 pr-3">Entity Kind</th>
                      <th className="pb-2 pr-3 text-right">Auto-Bound</th>
                      <th className="pb-2 pr-3 text-right">Synthetic Bound</th>
                      <th className="pb-2 pr-3 text-right">Review Required</th>
                      <th className="pb-2 text-right">Synthetic Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...identityData.repairMetrics]
                      .sort((a, b) => b.auto_bound - a.auto_bound)
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">
                            {row.entity_kind ?? "—"}
                            {row.synthetic_created > 0 && (
                              <span className="ml-2 rounded bg-amber-400/10 px-1 py-0.5 text-[10px] font-medium text-amber-300">
                                Synthetic — Banker Confirmation Required
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-3 text-right text-emerald-400">
                            {row.auto_bound}
                          </td>
                          <td className={`py-1 pr-3 text-right ${
                            row.synthetic_bound > 0 ? "text-amber-400" : "text-white/40"
                          }`}>
                            {row.synthetic_bound}
                          </td>
                          <td className={`py-1 pr-3 text-right font-semibold ${
                            row.review_required > 0 ? "text-red-400" : "text-white/40"
                          }`}>
                            {row.review_required}
                          </td>
                          <td className={`py-1 text-right ${
                            row.synthetic_created > 0 ? "text-amber-400" : "text-white/40"
                          }`}>
                            {row.synthetic_created}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Panel 7: Identity Intelligence (Layer 2.5) */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-medium text-white/60">
                Identity Intelligence
              </h3>
              {identityData.intelligenceMetrics.length === 0 ? (
                <p className="text-xs text-white/40 italic">
                  No intelligence events yet (ENABLE_IDENTITY_INTELLIGENCE may be off)
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-white/40">
                      <th className="pb-2 pr-3">Entity Kind</th>
                      <th className="pb-2 pr-3 text-right">Synthetics Refined</th>
                      <th className="pb-2 pr-3 text-right">Relationships Inferred</th>
                      <th className="pb-2 text-right">Manual Confirmations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...identityData.intelligenceMetrics]
                      .sort((a, b) => b.synthetics_refined - a.synthetics_refined)
                      .map((row, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1 pr-3 font-mono text-white/90">
                            {row.entity_kind ?? "—"}
                          </td>
                          <td className={`py-1 pr-3 text-right ${
                            row.synthetics_refined > 0 ? "text-emerald-400" : "text-white/40"
                          }`}>
                            {row.synthetics_refined}
                          </td>
                          <td className={`py-1 pr-3 text-right ${
                            row.relationships_inferred > 0 ? "text-emerald-400" : "text-white/40"
                          }`}>
                            {row.relationships_inferred}
                          </td>
                          <td className={`py-1 text-right ${
                            row.manual_confirmations > 0 ? "text-sky-400" : "text-white/40"
                          }`}>
                            {row.manual_confirmations}
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
      {/* ── Panel 8: Segmentation Health (Phase A) ───────────────────── */}
      {segmentationData !== null && (
        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="mb-6 text-lg font-semibold text-white/80">
            Segmentation Health
          </h2>
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Multi-form PDF Split Metrics
            </h3>
            {segmentationData.length === 0 ? (
              <p className="text-xs text-white/40 italic">
                No segmentation events yet (ENABLE_SEGMENTATION_ENGINE may be off)
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-left text-white/40">
                    <th className="pb-2 pr-3">Document Type</th>
                    <th className="pb-2 pr-3 text-right">Parents Split</th>
                    <th className="pb-2 pr-3 text-right">Total Segments</th>
                    <th className="pb-2 pr-3 text-right">Split Failures</th>
                    <th className="pb-2 text-right">Avg Children</th>
                  </tr>
                </thead>
                <tbody>
                  {[...segmentationData]
                    .sort((a, b) => b.total_segments_created - a.total_segments_created)
                    .map((row, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="py-1 pr-3 font-mono text-white/90">
                          {row.document_type ?? "—"}
                        </td>
                        <td className={`py-1 pr-3 text-right ${
                          row.total_segments_created > 0 ? "text-emerald-400" : "text-white/40"
                        }`}>
                          {row.parent_docs_split}
                        </td>
                        <td className={`py-1 pr-3 text-right ${
                          row.total_segments_created > 0 ? "text-emerald-400 font-semibold" : "text-white/40"
                        }`}>
                          {row.total_segments_created}
                        </td>
                        <td className={`py-1 pr-3 text-right font-semibold ${
                          row.split_failures > 0 ? "text-amber-400" : "text-white/40"
                        }`}>
                          {row.split_failures}
                        </td>
                        <td className="py-1 text-right text-white/60">
                          {row.avg_children != null ? row.avg_children.toFixed(1) : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {/* ── Panel 9: Override Intelligence (Phase B) ─────────────────── */}
      {overrideIntelligence !== null && (
        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="mb-6 text-lg font-semibold text-white/80">
            Override Intelligence
          </h2>

          {/* A. Clusters — Stability View */}
          <div className="mb-8">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Classification Correction Clusters (≥3 overrides)
            </h3>
            {overrideIntelligence.clusters.length === 0 ? (
              <p className="text-xs text-white/40 italic">
                No override clusters yet (need ≥ 3 identical corrections).{" "}
                Note: ENABLE_OVERRIDE_INTELLIGENCE controls cluster analysis only — override events always emit.
              </p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="pb-2 pr-3 text-left">From → To</th>
                    <th className="pb-2 pr-3 text-right">Count</th>
                    <th className="pb-2 pr-3 text-right">Avg Confidence</th>
                    <th className="pb-2 pr-3 text-left">Source</th>
                    <th className="pb-2 pr-3 text-left">Version Range</th>
                    <th className="pb-2 pr-3 text-right">Seg Ratio</th>
                    <th className="pb-2 text-left">First Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {overrideIntelligence.clusters.map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 pr-3 font-mono text-white/90">
                        {row.from_type ?? "—"} → {row.to_type ?? "—"}
                      </td>
                      <td className={`py-1 pr-3 text-right font-semibold ${
                        row.override_count >= 20
                          ? "text-red-400"
                          : row.override_count >= 10
                            ? "text-amber-400"
                            : "text-white/70"
                      }`}>
                        {row.override_count}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/60">
                        {row.avg_confidence_at_time != null
                          ? row.avg_confidence_at_time.toFixed(3)
                          : "—"}
                      </td>
                      <td className="py-1 pr-3 text-white/60">
                        {row.dominant_classifier_source ?? "—"}
                      </td>
                      <td className="py-1 pr-3 font-mono text-white/40">
                        {row.classification_version_range ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/60">
                        {row.segmentation_presence_ratio != null
                          ? `${(row.segmentation_presence_ratio * 100).toFixed(0)}%`
                          : "—"}
                      </td>
                      <td className="py-1 text-white/40">
                        {row.first_seen_at
                          ? new Date(row.first_seen_at).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* B. Drift — Velocity View */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Override Rate Drift (Week-over-Week)
            </h3>
            {overrideIntelligence.drift.length === 0 ? (
              <p className="text-xs text-white/40 italic">
                No drift data yet — needs multiple weeks of override events.
              </p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="pb-2 pr-3 text-left">Week</th>
                    <th className="pb-2 pr-3 text-left">From → To</th>
                    <th className="pb-2 pr-3 text-right">Count</th>
                    <th className="pb-2 pr-3 text-right">Delta</th>
                    <th className="pb-2 pr-3 text-left">Classifier</th>
                    <th className="pb-2 text-left">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {overrideIntelligence.drift
                    .filter((row) => row.delta !== 0)
                    .slice(0, 40)
                    .map((row, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="py-1 pr-3 text-white/40">
                          {row.week_start
                            ? new Date(row.week_start).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="py-1 pr-3 font-mono text-white/90">
                          {row.from_type ?? "—"} → {row.to_type ?? "—"}
                        </td>
                        <td className="py-1 pr-3 text-right text-white/70">
                          {row.weekly_count}
                        </td>
                        <td className={`py-1 pr-3 text-right font-semibold ${
                          row.delta >= 5
                            ? "text-red-400"
                            : row.delta >= 3
                              ? "text-amber-400"
                              : row.delta > 0
                                ? "text-white/60"
                                : "text-emerald-400"
                        }`}>
                          {row.delta > 0 ? `+${row.delta}` : row.delta}
                        </td>
                        <td className="py-1 pr-3 text-white/50">
                          {row.classifier_source ?? "—"}
                        </td>
                        <td className="py-1 font-mono text-white/40">
                          {row.classification_version ?? "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Panel 10: Intake Governance (Phase C) ─────────────────────── */}
      {intakeGovernance !== null && (
        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="mb-6 text-lg font-semibold text-white/80">
            Intake Governance
          </h2>

          {/* Worker Health */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Worker Health
            </h3>
            {intakeGovernance.workerHealth.length === 0 ? (
              <p className="text-xs text-white/40 italic">All systems healthy — no workers registered.</p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="pb-2 pr-3 text-left">Worker ID</th>
                    <th className="pb-2 pr-3 text-left">Type</th>
                    <th className="pb-2 pr-3 text-left">Status</th>
                    <th className="pb-2 pr-3 text-right">Secs Since Heartbeat</th>
                    <th className="pb-2 pr-3 text-right">Consecutive Failures</th>
                    <th className="pb-2 text-center">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {intakeGovernance.workerHealth.map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 pr-3 font-mono text-white/90 text-xs">{row.worker_id ?? "—"}</td>
                      <td className="py-1 pr-3 text-white/60">{row.worker_type ?? "—"}</td>
                      <td className="py-1 pr-3 text-white/50">{row.status ?? "—"}</td>
                      <td className={`py-1 pr-3 text-right font-mono ${
                        (row.seconds_since_heartbeat ?? 0) > 180
                          ? "text-red-400 font-semibold"
                          : (row.seconds_since_heartbeat ?? 0) > 60
                            ? "text-amber-400"
                            : "text-emerald-400"
                      }`}>
                        {row.seconds_since_heartbeat != null ? row.seconds_since_heartbeat : "—"}
                      </td>
                      <td className={`py-1 pr-3 text-right ${
                        (row.consecutive_failures ?? 0) > 0 ? "text-amber-400" : "text-white/40"
                      }`}>
                        {row.consecutive_failures ?? 0}
                      </td>
                      <td className="py-1 text-center">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                          row.health_color === "red"
                            ? "bg-red-400"
                            : row.health_color === "amber"
                              ? "bg-amber-400"
                              : "bg-emerald-400"
                        }`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Queue Latency */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Queue Latency
            </h3>
            {intakeGovernance.queueLatency.length === 0 ? (
              <p className="text-xs text-white/40 italic">All systems healthy — no queued jobs detected.</p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="pb-2 pr-3 text-left">Job Type</th>
                    <th className="pb-2 pr-3 text-right">Queued Count</th>
                    <th className="pb-2 pr-3 text-right">Max Age (secs)</th>
                    <th className="pb-2 text-center">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {intakeGovernance.queueLatency.map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 pr-3 font-mono text-white/90">{row.job_type ?? "—"}</td>
                      <td className={`py-1 pr-3 text-right ${
                        (row.queued_count ?? 0) > 10 ? "text-amber-400" : "text-white/70"
                      }`}>
                        {row.queued_count ?? 0}
                      </td>
                      <td className={`py-1 pr-3 text-right font-mono ${
                        (row.max_queue_age_seconds ?? 0) > 300
                          ? "text-red-400 font-semibold"
                          : (row.max_queue_age_seconds ?? 0) > 120
                            ? "text-amber-400"
                            : "text-emerald-400"
                      }`}>
                        {row.max_queue_age_seconds != null ? row.max_queue_age_seconds : "—"}
                      </td>
                      <td className="py-1 text-center">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                          row.health_color === "red"
                            ? "bg-red-400"
                            : row.health_color === "amber"
                              ? "bg-amber-400"
                              : "bg-emerald-400"
                        }`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* OCR Failures */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              OCR Health (last 24h)
            </h3>
            {intakeGovernance.ocrFailures.total_24h === 0 ? (
              <p className="text-xs text-white/40 italic">All systems healthy — no OCR jobs in last 24h.</p>
            ) : (
              <div className="flex items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Total</span>
                  <span className="mt-1 text-xl font-semibold text-white/70">
                    {intakeGovernance.ocrFailures.total_24h}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Failed</span>
                  <span className={`mt-1 text-xl font-semibold ${
                    intakeGovernance.ocrFailures.failed_count_24h > 5
                      ? "text-red-400"
                      : intakeGovernance.ocrFailures.failed_count_24h > 0
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }`}>
                    {intakeGovernance.ocrFailures.failed_count_24h}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Empty OCR</span>
                  <span className={`mt-1 text-xl font-semibold ${
                    intakeGovernance.ocrFailures.empty_ocr_count_24h > 0
                      ? "text-amber-400"
                      : "text-emerald-400"
                  }`}>
                    {intakeGovernance.ocrFailures.empty_ocr_count_24h}
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-xs text-white/40 uppercase tracking-wider">Health</span>
                  <span className={`mt-1 inline-block h-3 w-3 rounded-full ${
                    intakeGovernance.ocrFailures.health_color === "red"
                      ? "bg-red-400"
                      : intakeGovernance.ocrFailures.health_color === "amber"
                        ? "bg-amber-400"
                        : "bg-emerald-400"
                  }`} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Panel 11: Intake Signal Intelligence (Phase D) ────────────────── */}
      {intakeSignal !== null && (
        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="mb-6 text-lg font-semibold text-white/80">
            Intake Signal Intelligence
          </h2>

          {/* D1: Signal Strength Heatmap */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Signal Strength by Doc Type
            </h3>
            {intakeSignal.signalStrength.length === 0 ? (
              <p className="text-xs text-white/40 italic">No signal data available.</p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="pb-2 pr-3 text-left">Doc Type</th>
                    <th className="pb-2 pr-3 text-right">Total</th>
                    <th className="pb-2 pr-3 text-right">Avg Conf</th>
                    <th className="pb-2 pr-3 text-right">Stddev</th>
                    <th className="pb-2 pr-3 text-right">Low Conf</th>
                    <th className="pb-2 text-center">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {intakeSignal.signalStrength.map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 pr-3 font-mono text-white/90">
                        {row.effective_doc_type ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/60">
                        {row.total_docs ?? "—"}
                      </td>
                      <td className={`py-1 pr-3 text-right font-semibold ${
                        (row.avg_confidence ?? 0) >= 0.85
                          ? "text-emerald-400"
                          : (row.avg_confidence ?? 0) >= 0.70
                            ? "text-amber-400"
                            : "text-red-400"
                      }`}>
                        {row.avg_confidence != null
                          ? (row.avg_confidence * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/50">
                        {row.confidence_stddev != null
                          ? row.confidence_stddev.toFixed(3)
                          : "—"}
                      </td>
                      <td className={`py-1 pr-3 text-right ${
                        (row.low_confidence_count ?? 0) > 0 ? "text-amber-400" : "text-white/40"
                      }`}>
                        {row.low_confidence_count ?? 0}
                      </td>
                      <td className="py-1 text-center">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                          row.health_color === "red"
                            ? "bg-red-400"
                            : row.health_color === "amber"
                              ? "bg-amber-400"
                              : "bg-emerald-400"
                        }`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* D2: Source Dependency Matrix */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Source Dependency Matrix
            </h3>
            {intakeSignal.classifierSourceMix.length === 0 ? (
              <p className="text-xs text-white/40 italic">No signal data available.</p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="pb-2 pr-3 text-left">Doc Type</th>
                    <th className="pb-2 pr-3 text-left">Source</th>
                    <th className="pb-2 pr-3 text-right">Count</th>
                    <th className="pb-2 pr-3 text-right">Fraction</th>
                    <th className="pb-2 text-right">Avg Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {intakeSignal.classifierSourceMix.map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 pr-3 font-mono text-white/70">
                        {row.effective_doc_type ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-white/60">
                        {row.match_source ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/60">
                        {row.doc_count ?? "—"}
                      </td>
                      <td className={`py-1 pr-3 text-right font-semibold ${
                        row.match_source === "ai_classification" &&
                        (row.fraction_within_type ?? 0) > 0.40
                          ? "text-amber-400"
                          : "text-white/60"
                      }`}>
                        {row.fraction_within_type != null
                          ? (row.fraction_within_type * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                      <td className="py-1 text-right text-white/50">
                        {row.avg_confidence != null
                          ? (row.avg_confidence * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* D3: Segmentation ROI */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Segmentation ROI
            </h3>
            {intakeSignal.segmentationImpact.length === 0 ? (
              <p className="text-xs text-white/40 italic">No signal data available.</p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="pb-2 pr-3 text-left">Class</th>
                    <th className="pb-2 pr-3 text-right">Count</th>
                    <th className="pb-2 pr-3 text-right">Avg Conf</th>
                    <th className="pb-2 pr-3 text-right">Avg Seconds</th>
                    <th className="pb-2 text-right">Override Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {intakeSignal.segmentationImpact.map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 pr-3 font-semibold text-white/80">
                        {row.document_class ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/60">
                        {row.doc_count ?? "—"}
                      </td>
                      <td className={`py-1 pr-3 text-right ${
                        (row.avg_confidence ?? 0) >= 0.85
                          ? "text-emerald-400"
                          : (row.avg_confidence ?? 0) >= 0.70
                            ? "text-amber-400"
                            : "text-red-400"
                      }`}>
                        {row.avg_confidence != null
                          ? (row.avg_confidence * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/50">
                        {row.avg_classification_seconds != null
                          ? row.avg_classification_seconds.toFixed(1) + "s"
                          : "—"}
                      </td>
                      <td className={`py-1 text-right ${
                        (row.manual_override_rate ?? 0) > 0.25
                          ? "text-red-400 font-semibold"
                          : (row.manual_override_rate ?? 0) > 0.10
                            ? "text-amber-400"
                            : "text-white/60"
                      }`}>
                        {row.manual_override_rate != null
                          ? (row.manual_override_rate * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* D4: Entity Binding Stability */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Entity Binding Stability
            </h3>
            {intakeSignal.entityBindingCoverage.length === 0 ? (
              <p className="text-xs text-white/40 italic">No signal data available.</p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    {Object.keys(intakeSignal.entityBindingCoverage[0]).map((col) => (
                      <th key={col} className="pb-2 pr-3 text-left">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {intakeSignal.entityBindingCoverage.map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="py-1 pr-3 font-mono text-white/70">
                          {val != null ? String(val) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* D5: Override Signal Correlation */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-white/60">
              Override Signal Correlation
            </h3>
            {intakeSignal.overrideSignalCorrelation.length === 0 ? (
              <p className="text-xs text-white/40 italic">No signal data available.</p>
            ) : (
              <table className="w-full text-xs text-white/70">
                <thead>
                  <tr className="border-b border-white/10 text-white/40">
                    <th className="pb-2 pr-3 text-left">Doc Type</th>
                    <th className="pb-2 pr-3 text-right">Total</th>
                    <th className="pb-2 pr-3 text-right">Override Rate</th>
                    <th className="pb-2 pr-3 text-right">Recent (7d)</th>
                    <th className="pb-2 pr-3 text-right">Avg Conf</th>
                    <th className="pb-2 pr-3 text-right">Stddev</th>
                    <th className="pb-2 text-center">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {intakeSignal.overrideSignalCorrelation.map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 pr-3 font-mono text-white/90">
                        {row.effective_doc_type ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/60">
                        {row.total_docs ?? "—"}
                      </td>
                      <td className={`py-1 pr-3 text-right font-semibold ${
                        (row.manual_override_rate ?? 0) > 0.25
                          ? "text-red-400"
                          : (row.manual_override_rate ?? 0) > 0.10
                            ? "text-amber-400"
                            : "text-white/60"
                      }`}>
                        {row.manual_override_rate != null
                          ? (row.manual_override_rate * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                      <td className={`py-1 pr-3 text-right ${
                        (row.recent_manual_count ?? 0) > 0 ? "text-amber-400" : "text-white/40"
                      }`}>
                        {row.recent_manual_count ?? 0}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/50">
                        {row.avg_confidence != null
                          ? (row.avg_confidence * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                      <td className="py-1 pr-3 text-right text-white/40">
                        {row.confidence_stddev != null
                          ? row.confidence_stddev.toFixed(3)
                          : "—"}
                      </td>
                      <td className="py-1 text-center">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${
                          row.health_color === "red"
                            ? "bg-red-400"
                            : row.health_color === "amber"
                              ? "bg-amber-400"
                              : "bg-emerald-400"
                        }`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </GlassShell>
  );
}
