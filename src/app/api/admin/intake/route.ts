import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAdaptiveAutoAttachEnabled } from "@/lib/flags/adaptiveAutoAttach";
import {
  ADAPTIVE_THRESHOLD_VERSION,
  type CalibrationCurve,
  type SpineTierKey,
} from "@/lib/classification/thresholds/autoAttachThresholds";
import { resolveAutoAttachThreshold } from "@/lib/classification/thresholds/resolveAutoAttachThreshold";
import type { ConfidenceBand } from "@/lib/classification/calibrateConfidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

type SegmentationMetricRow = {
  document_type: string | null;
  parent_docs_split: number;
  total_segments_created: number;
  split_failures: number;
  avg_children: number | null;
};

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

type CalibrationCurveRow = {
  band: string | null;
  tier: string | null;
  total: number;
  overrides: number;
  override_rate: number | null;
};

type ResolvedThresholdRow = {
  tier: string;
  band: string;
  baseline: number;
  threshold: number;
  adapted: boolean;
  calibrationSamples: number;
  calibrationOverrideRate: number | null;
};

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

function unknownView(view: string | null) {
  return NextResponse.json(
    { ok: false, error: `unknown intake admin view: ${view ?? "missing"}` },
    { status: 404 },
  );
}

async function getAtomicMetrics() {
  try {
    const sb = supabaseAdmin();
    const [slotResult, docTypeResult, confResult] = await Promise.all([
      sb.from("slot_attachment_metrics_v1").select("*"),
      sb.from("doc_type_performance_v1").select("*"),
      sb.from("confidence_distribution_v1").select("*"),
    ]);

    if (slotResult.error) {
      console.error("[atomic-metrics] slot query error:", slotResult.error);
      return NextResponse.json(
        { ok: false, error: slotResult.error.message },
        { status: 500 },
      );
    }
    if (docTypeResult.error) {
      console.error("[atomic-metrics] doc type query error:", docTypeResult.error);
      return NextResponse.json(
        { ok: false, error: docTypeResult.error.message },
        { status: 500 },
      );
    }
    if (confResult.error) {
      console.error("[atomic-metrics] confidence query error:", confResult.error);
      return NextResponse.json(
        { ok: false, error: confResult.error.message },
        { status: 500 },
      );
    }

    const slotMetrics: SlotMetricRow[] = (slotResult.data ?? []).map((r: any) => ({
      slot_key: r.slot_key ?? "unknown",
      slot_id: r.slot_id ?? null,
      engine_version: r.engine_version ?? null,
      effective_doc_type: r.effective_doc_type ?? null,
      required_doc_type: r.required_doc_type ?? null,
      auto_attached: Number(r.auto_attached ?? 0),
      routed_to_review: Number(r.routed_to_review ?? 0),
      no_match: Number(r.no_match ?? 0),
      total_attempts: Number(r.total_attempts ?? 0),
      precision_rate: r.precision_rate != null ? Number(r.precision_rate) : null,
      friction_rate: r.friction_rate != null ? Number(r.friction_rate) : null,
    }));

    const docTypeMetrics: DocTypeMetricRow[] = (docTypeResult.data ?? []).map((r: any) => ({
      doc_type: r.doc_type ?? "unknown",
      engine_version: r.engine_version ?? null,
      auto_attached: Number(r.auto_attached ?? 0),
      routed_to_review: Number(r.routed_to_review ?? 0),
      no_match: Number(r.no_match ?? 0),
      total_match_events: Number(r.total_match_events ?? 0),
      override_count: Number(r.override_count ?? 0),
      auto_attach_rate: r.auto_attach_rate != null ? Number(r.auto_attach_rate) : null,
      override_rate: r.override_rate != null ? Number(r.override_rate) : null,
    }));

    const confidenceDistribution: ConfidenceBucket[] = (confResult.data ?? []).map((r: any) => ({
      confidence_bucket: r.confidence_bucket ?? "unknown",
      classification_tier: r.classification_tier ?? null,
      schema_version: r.schema_version ?? null,
      event_count: Number(r.event_count ?? 0),
    }));

    return NextResponse.json({
      ok: true,
      slotMetrics,
      docTypeMetrics,
      confidenceDistribution,
    });
  } catch (e: any) {
    console.error("[atomic-metrics] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}

async function getTopLeaks() {
  try {
    const sb = supabaseAdmin();
    const [
      slotOverridesResult,
      slotReviewResult,
      docTypeReviewResult,
      regressionResult,
      anomalyResult,
    ] = await Promise.all([
      sb.from("intake_top_slot_overrides_v1").select("*"),
      sb.from("intake_top_slot_review_v1").select("*"),
      sb.from("intake_top_doc_type_review_v1").select("*"),
      sb.from("intake_engine_regression_v1").select("*"),
      sb.from("intake_confidence_anomalies_v1").select("*"),
    ]);

    if (slotOverridesResult.error) {
      console.error("[top-leaks] slot overrides error:", slotOverridesResult.error);
      return NextResponse.json(
        { ok: false, error: slotOverridesResult.error.message },
        { status: 500 },
      );
    }
    if (slotReviewResult.error) {
      console.error("[top-leaks] slot review error:", slotReviewResult.error);
      return NextResponse.json(
        { ok: false, error: slotReviewResult.error.message },
        { status: 500 },
      );
    }
    if (docTypeReviewResult.error) {
      console.error("[top-leaks] doc type review error:", docTypeReviewResult.error);
      return NextResponse.json(
        { ok: false, error: docTypeReviewResult.error.message },
        { status: 500 },
      );
    }
    if (regressionResult.error) {
      console.error("[top-leaks] regression error:", regressionResult.error);
      return NextResponse.json(
        { ok: false, error: regressionResult.error.message },
        { status: 500 },
      );
    }
    if (anomalyResult.error) {
      console.error("[top-leaks] anomaly error:", anomalyResult.error);
      return NextResponse.json(
        { ok: false, error: anomalyResult.error.message },
        { status: 500 },
      );
    }

    const topSlotOverrides = (slotOverridesResult.data ?? []).map((r: any) => ({
      slot_key: r.slot_key ?? "unknown",
      slot_id: r.slot_id ?? null,
      effective_doc_type: r.effective_doc_type ?? null,
      required_doc_type: r.required_doc_type ?? null,
      engine_version: r.engine_version ?? null,
      auto_attached: Number(r.auto_attached ?? 0),
      routed_to_review: Number(r.routed_to_review ?? 0),
      total_attempts: Number(r.total_attempts ?? 0),
      precision_rate: r.precision_rate != null ? Number(r.precision_rate) : null,
      friction_rate: r.friction_rate != null ? Number(r.friction_rate) : null,
      override_count: Number(r.override_count ?? 0),
      override_rate: Number(r.override_rate ?? 0),
    }));

    const topSlotReview = (slotReviewResult.data ?? []).map((r: any) => ({
      slot_key: r.slot_key ?? "unknown",
      slot_id: r.slot_id ?? null,
      effective_doc_type: r.effective_doc_type ?? null,
      required_doc_type: r.required_doc_type ?? null,
      engine_version: r.engine_version ?? null,
      routed_to_review: Number(r.routed_to_review ?? 0),
      total_attempts: Number(r.total_attempts ?? 0),
      review_rate: r.review_rate != null ? Number(r.review_rate) : null,
    }));

    const topDocTypeReview = (docTypeReviewResult.data ?? []).map((r: any) => ({
      doc_type: r.doc_type ?? "unknown",
      engine_version: r.engine_version ?? null,
      total_match_events: Number(r.total_match_events ?? 0),
      routed_to_review: Number(r.routed_to_review ?? 0),
      review_rate: r.review_rate != null ? Number(r.review_rate) : null,
    }));

    const engineRegression = (regressionResult.data ?? []).map((r: any) => ({
      doc_type: r.doc_type ?? "unknown",
      engine_version: r.engine_version ?? "",
      auto_attach_rate: r.auto_attach_rate != null ? Number(r.auto_attach_rate) : null,
      prior_attach_rate: r.prior_attach_rate != null ? Number(r.prior_attach_rate) : null,
      delta: r.delta != null ? Number(r.delta) : null,
    }));

    const confidenceAnomalies = (anomalyResult.data ?? []).map((r: any) => ({
      doc_type: r.doc_type ?? "unknown",
      engine_version: r.engine_version ?? null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      sample_count: Number(r.sample_count ?? 0),
      auto_attach_rate: r.auto_attach_rate != null ? Number(r.auto_attach_rate) : null,
    }));

    return NextResponse.json({
      ok: true,
      topSlotOverrides,
      topSlotReview,
      topDocTypeReview,
      engineRegression,
      confidenceAnomalies,
    });
  } catch (e: any) {
    console.error("[top-leaks] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}

async function getIdentity() {
  try {
    const sb = supabaseAdmin();
    const [
      coverageResult,
      ambiguityResult,
      enforcementResult,
      precisionResult,
      bindingResult,
      repairResult,
      intelligenceResult,
    ] = await Promise.all([
      sb.from("identity_resolution_coverage_v1").select("*"),
      sb.from("identity_ambiguity_hotspots_v1").select("*"),
      sb.from("identity_enforcement_events_v1").select("*"),
      sb.from("identity_precision_effect_v1").select("*"),
      sb.from("slot_entity_binding_coverage_v1").select("*"),
      sb.from("slot_entity_binding_repair_v1").select("*"),
      sb.from("identity_intelligence_metrics_v1").select("*"),
    ]);

    if (coverageResult.error) {
      console.error("[identity] coverage query error:", coverageResult.error);
      return NextResponse.json(
        { ok: false, error: coverageResult.error.message },
        { status: 500 },
      );
    }
    if (ambiguityResult.error) {
      console.error("[identity] ambiguity query error:", ambiguityResult.error);
      return NextResponse.json(
        { ok: false, error: ambiguityResult.error.message },
        { status: 500 },
      );
    }

    const coverage: IdentityCoverageRow[] = (coverageResult.data ?? []).map((r: any) => ({
      doc_type: r.doc_type ?? "unknown",
      engine_version: r.engine_version ?? null,
      total_events: Number(r.total_events ?? 0),
      resolved_count: Number(r.resolved_count ?? 0),
      resolution_rate: r.resolution_rate != null ? Number(r.resolution_rate) : null,
    }));

    const ambiguityHotspots: IdentityAmbiguityRow[] = (ambiguityResult.data ?? []).map((r: any) => ({
      doc_type: r.doc_type ?? "unknown",
      total_events: Number(r.total_events ?? 0),
      ambiguous_count: Number(r.ambiguous_count ?? 0),
      ambiguity_rate: r.ambiguity_rate != null ? Number(r.ambiguity_rate) : null,
    }));

    const enforcementEvents: IdentityEnforcementRow[] = enforcementResult.error
      ? []
      : (enforcementResult.data ?? []).map((r: any) => ({
          doc_type: r.doc_type ?? "unknown",
          engine_version: r.engine_version ?? null,
          enforcement_count: Number(r.enforcement_count ?? 0),
        }));
    if (enforcementResult.error) {
      console.warn("[identity] enforcement query error (non-fatal):", enforcementResult.error);
    }

    const precisionMetrics: IdentityPrecisionRow[] = precisionResult.error
      ? []
      : (precisionResult.data ?? []).map((r: any) => ({
          doc_type: r.doc_type ?? "unknown",
          engine_version: r.engine_version ?? null,
          high_confidence_events: Number(r.high_confidence_events ?? 0),
          precision_auto_attached: Number(r.precision_auto_attached ?? 0),
        }));
    if (precisionResult.error) {
      console.warn("[identity] precision query error (non-fatal):", precisionResult.error);
    }

    const slotBindingCoverage: IdentitySlotBindingRow[] = bindingResult.error
      ? []
      : (bindingResult.data ?? []).map((r: any) => ({
          doc_type: r.doc_type ?? "unknown",
          total_slots: Number(r.total_slots ?? 0),
          bound_slots: Number(r.bound_slots ?? 0),
          unbound_slots: Number(r.unbound_slots ?? 0),
          binding_rate_pct: r.binding_rate_pct != null ? Number(r.binding_rate_pct) : null,
        }));
    if (bindingResult.error) {
      console.warn("[identity] slot binding query error (non-fatal):", bindingResult.error);
    }

    const repairMetrics: IdentityRepairRow[] = repairResult.error
      ? []
      : (repairResult.data ?? []).map((r: any) => ({
          entity_kind: r.entity_kind ?? null,
          auto_bound: Number(r.auto_bound ?? 0),
          synthetic_bound: Number(r.synthetic_bound ?? 0),
          review_required: Number(r.review_required ?? 0),
          synthetic_created: Number(r.synthetic_created ?? 0),
        }));
    if (repairResult.error) {
      console.warn("[identity] repair metrics query error (non-fatal):", repairResult.error);
    }

    const intelligenceMetrics: IdentityIntelligenceRow[] = intelligenceResult.error
      ? []
      : (intelligenceResult.data ?? []).map((r: any) => ({
          entity_kind: r.entity_kind ?? null,
          synthetics_refined: Number(r.synthetics_refined ?? 0),
          relationships_inferred: Number(r.relationships_inferred ?? 0),
          manual_confirmations: Number(r.manual_confirmations ?? 0),
        }));
    if (intelligenceResult.error) {
      console.warn("[identity] intelligence metrics query error (non-fatal):", intelligenceResult.error);
    }

    return NextResponse.json({
      ok: true,
      coverage,
      ambiguityHotspots,
      enforcementEvents,
      precisionMetrics,
      slotBindingCoverage,
      repairMetrics,
      intelligenceMetrics,
    });
  } catch (e: any) {
    console.error("[identity] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}

async function getSegmentation() {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await (sb as any).from("segmentation_metrics_v1").select("*");

    if (error) {
      console.warn("[admin/segmentation] metrics query error (non-fatal):", error);
      return NextResponse.json({ ok: true, segmentationMetrics: [] });
    }

    const segmentationMetrics: SegmentationMetricRow[] = (data ?? []).map((r: any) => ({
      document_type: r.document_type ?? null,
      parent_docs_split: Number(r.parent_docs_split ?? 0),
      total_segments_created: Number(r.total_segments_created ?? 0),
      split_failures: Number(r.split_failures ?? 0),
      avg_children: r.avg_children != null ? Number(r.avg_children) : null,
    }));

    return NextResponse.json({ ok: true, segmentationMetrics });
  } catch (e: any) {
    console.error("[admin/segmentation] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}

async function getOverride() {
  try {
    const sb = supabaseAdmin();
    const { data: clusterData, error: clusterError } = await (sb as any)
      .from("override_clusters_v1")
      .select("*")
      .order("override_count", { ascending: false })
      .limit(100);
    if (clusterError) {
      console.warn("[admin/override] clusters query error (non-fatal):", clusterError);
    }

    const { data: driftData, error: driftError } = await (sb as any)
      .from("override_drift_v1")
      .select("*")
      .order("week_start", { ascending: false })
      .order("delta", { ascending: false })
      .limit(100);
    if (driftError) {
      console.warn("[admin/override] drift query error (non-fatal):", driftError);
    }

    const clusters: OverrideClusterRow[] = (clusterData ?? []).map((r: any) => ({
      from_type: r.from_type ?? null,
      to_type: r.to_type ?? null,
      override_count: Number(r.override_count ?? 0),
      avg_confidence_at_time: r.avg_confidence_at_time != null ? Number(r.avg_confidence_at_time) : null,
      dominant_classifier_source: r.dominant_classifier_source ?? null,
      dominant_confidence_bucket: r.dominant_confidence_bucket ?? null,
      classification_version_range: r.classification_version_range ?? null,
      segmentation_presence_ratio: r.segmentation_presence_ratio != null ? Number(r.segmentation_presence_ratio) : null,
      first_seen_at: r.first_seen_at ?? null,
      last_seen_at: r.last_seen_at ?? null,
    }));

    const drift: OverrideDriftRow[] = (driftData ?? []).map((r: any) => ({
      week_start: r.week_start ?? null,
      from_type: r.from_type ?? null,
      to_type: r.to_type ?? null,
      classifier_source: r.classifier_source ?? null,
      classification_version: r.classification_version ?? null,
      weekly_count: Number(r.weekly_count ?? 0),
      prev_week_count: r.prev_week_count != null ? Number(r.prev_week_count) : null,
      delta: Number(r.delta ?? 0),
    }));

    const { data: calibrationData, error: calibrationError } = await (sb as any)
      .from("classification_calibration_curve_v1")
      .select("*");
    if (calibrationError) {
      console.warn("[admin/override] calibration query error (non-fatal):", calibrationError);
    }

    const calibration: CalibrationCurveRow[] = (calibrationData ?? []).map((r: any) => ({
      band: r.band ?? null,
      tier: r.tier ?? null,
      total: Number(r.total ?? 0),
      overrides: Number(r.overrides ?? 0),
      override_rate: r.override_rate != null ? Number(r.override_rate) : null,
    }));

    let resolvedThresholds: ResolvedThresholdRow[] | null = null;
    let adaptiveVersion: string | null = null;

    if (isAdaptiveAutoAttachEnabled()) {
      adaptiveVersion = ADAPTIVE_THRESHOLD_VERSION;
      const allTiers: SpineTierKey[] = [
        "tier1_anchor",
        "tier2_structural",
        "tier3_llm",
        "fallback",
      ];
      const allBands: ConfidenceBand[] = ["HIGH", "MEDIUM", "LOW"];

      const curve: CalibrationCurve = calibration
        .filter((r): r is CalibrationCurveRow & { band: string; tier: string } => r.band != null && r.tier != null)
        .map((r) => ({
          tier: r.tier as SpineTierKey,
          band: r.band as ConfidenceBand,
          total: r.total,
          overrides: r.overrides,
          overrideRate: r.override_rate ?? 0,
        }));

      resolvedThresholds = [];
      for (const tier of allTiers) {
        for (const band of allBands) {
          const result = resolveAutoAttachThreshold(tier, band, curve);
          resolvedThresholds.push({
            tier: result.tier,
            band: result.band,
            baseline: result.baseline,
            threshold: result.threshold,
            adapted: result.adapted,
            calibrationSamples: result.calibrationSamples,
            calibrationOverrideRate: result.calibrationOverrideRate,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      clusters,
      drift,
      calibration,
      resolvedThresholds,
      adaptiveVersion,
    });
  } catch (e: any) {
    console.error("[admin/override] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}

async function getReliability() {
  try {
    const sb = supabaseAdmin();
    const [workerRes, queueRes, ocrRes] = await Promise.all([
      (sb as any).from("intake_worker_health_v1").select("*"),
      (sb as any).from("intake_queue_latency_v1").select("*"),
      (sb as any).from("intake_ocr_failures_v1").select("*").maybeSingle(),
    ]);

    if (workerRes.error) {
      console.warn("[admin/reliability] worker health query error (non-fatal):", workerRes.error);
    }
    if (queueRes.error) {
      console.warn("[admin/reliability] queue latency query error (non-fatal):", queueRes.error);
    }
    if (ocrRes.error) {
      console.warn("[admin/reliability] OCR failures query error (non-fatal):", ocrRes.error);
    }

    const workerHealth: WorkerHealthRow[] = (workerRes.data ?? []).map((r: any) => ({
      worker_id: r.worker_id ?? null,
      worker_type: r.worker_type ?? null,
      status: r.status ?? null,
      last_heartbeat_at: r.last_heartbeat_at ?? null,
      seconds_since_heartbeat: r.seconds_since_heartbeat != null ? Number(r.seconds_since_heartbeat) : null,
      consecutive_failures: r.consecutive_failures != null ? Number(r.consecutive_failures) : null,
      health_color: r.health_color ?? null,
    }));

    const queueLatency: QueueLatencyRow[] = (queueRes.data ?? []).map((r: any) => ({
      job_type: r.job_type ?? null,
      queued_count: r.queued_count != null ? Number(r.queued_count) : null,
      max_queue_age_seconds: r.max_queue_age_seconds != null ? Number(r.max_queue_age_seconds) : null,
      health_color: r.health_color ?? null,
    }));

    const rawOcr = ocrRes.data;
    const ocrFailures: OcrFailuresRow = {
      failed_count_24h: Number(rawOcr?.failed_count_24h ?? 0),
      empty_ocr_count_24h: Number(rawOcr?.empty_ocr_count_24h ?? 0),
      total_24h: Number(rawOcr?.total_24h ?? 0),
      health_color: rawOcr?.health_color ?? null,
    };

    return NextResponse.json({ ok: true, workerHealth, queueLatency, ocrFailures });
  } catch (e: any) {
    console.error("[admin/reliability] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}

async function getSignal() {
  try {
    const sb = supabaseAdmin();
    const [strengthRes, mixRes, segRes, bindingRes, correlationRes] =
      await Promise.all([
        (sb as any).from("intake_signal_strength_v1").select("*"),
        (sb as any).from("intake_classifier_source_mix_v1").select("*"),
        (sb as any).from("intake_segmentation_impact_v1").select("*"),
        (sb as any).from("slot_entity_binding_coverage_v1").select("*"),
        (sb as any).from("intake_override_signal_correlation_v1").select("*"),
      ]);

    if (strengthRes.error) {
      console.warn("[admin/signal] signal strength query error (non-fatal):", strengthRes.error);
    }
    if (mixRes.error) {
      console.warn("[admin/signal] classifier source mix query error (non-fatal):", mixRes.error);
    }
    if (segRes.error) {
      console.warn("[admin/signal] segmentation impact query error (non-fatal):", segRes.error);
    }
    if (bindingRes.error) {
      console.warn("[admin/signal] entity binding coverage query error (non-fatal):", bindingRes.error);
    }
    if (correlationRes.error) {
      console.warn("[admin/signal] override correlation query error (non-fatal):", correlationRes.error);
    }

    const signalStrength: SignalStrengthRow[] = (strengthRes.data ?? []).map((r: any) => ({
      effective_doc_type: r.effective_doc_type ?? null,
      total_docs: r.total_docs != null ? Number(r.total_docs) : null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      min_confidence: r.min_confidence != null ? Number(r.min_confidence) : null,
      max_confidence: r.max_confidence != null ? Number(r.max_confidence) : null,
      confidence_stddev: r.confidence_stddev != null ? Number(r.confidence_stddev) : null,
      low_confidence_count: r.low_confidence_count != null ? Number(r.low_confidence_count) : null,
      health_color: r.health_color ?? null,
    }));

    const classifierSourceMix: ClassifierSourceMixRow[] = (mixRes.data ?? []).map((r: any) => ({
      effective_doc_type: r.effective_doc_type ?? null,
      match_source: r.match_source ?? null,
      doc_count: r.doc_count != null ? Number(r.doc_count) : null,
      fraction_within_type: r.fraction_within_type != null ? Number(r.fraction_within_type) : null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
    }));

    const segmentationImpact: SegmentationImpactRow[] = (segRes.data ?? []).map((r: any) => ({
      document_class: r.document_class ?? null,
      doc_count: r.doc_count != null ? Number(r.doc_count) : null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      avg_classification_seconds: r.avg_classification_seconds != null ? Number(r.avg_classification_seconds) : null,
      manual_override_rate: r.manual_override_rate != null ? Number(r.manual_override_rate) : null,
    }));

    const entityBindingCoverage: EntityBindingRow[] = bindingRes.data ?? [];

    const overrideSignalCorrelation: OverrideCorrelationRow[] = (correlationRes.data ?? []).map((r: any) => ({
      effective_doc_type: r.effective_doc_type ?? null,
      total_docs: r.total_docs != null ? Number(r.total_docs) : null,
      manual_override_count: r.manual_override_count != null ? Number(r.manual_override_count) : null,
      recent_manual_count: r.recent_manual_count != null ? Number(r.recent_manual_count) : null,
      manual_override_rate: r.manual_override_rate != null ? Number(r.manual_override_rate) : null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      confidence_stddev: r.confidence_stddev != null ? Number(r.confidence_stddev) : null,
      health_color: r.health_color ?? null,
    }));

    return NextResponse.json({
      ok: true,
      signalStrength,
      classifierSourceMix,
      segmentationImpact,
      entityBindingCoverage,
      overrideSignalCorrelation,
    });
  } catch (e: any) {
    console.error("[admin/signal] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const view = req.nextUrl.searchParams.get("view");

  switch (view) {
    case "atomic-metrics":
      return getAtomicMetrics();
    case "top-leaks":
      return getTopLeaks();
    case "identity":
      return getIdentity();
    case "segmentation":
      return getSegmentation();
    case "override":
      return getOverride();
    case "reliability":
      return getReliability();
    case "signal":
      return getSignal();
    default:
      return unknownView(view);
  }
}
