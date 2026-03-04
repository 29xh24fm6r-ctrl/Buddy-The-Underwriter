"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { CONFIDENCE_THRESHOLDS } from "@/lib/classification/calibrateConfidence";
import {
  MAX_PROCESSING_WINDOW_MS,
  POLL_INITIAL_MS,
  POLL_BACKOFF_MS,
  POLL_MAX_MS,
} from "@/lib/intake/constants";
import { getStuckReasonUx } from "@/lib/intake/processing/stuckReasonUx";
import { scrubPii } from "@/lib/intake/processing/summarizeProcessingError";
import type { StuckReason } from "@/lib/intake/processing/detectStuckProcessing";

// ── Types ──────────────────────────────────────────────────────────────

type IntakeDoc = {
  id: string;
  original_filename: string | null;
  canonical_type: string | null;
  document_type: string | null;
  checklist_key: string | null;
  doc_year: number | null;
  match_source: string | null;
  ai_doc_type: string | null;
  ai_confidence: number | null;
  classification_tier: string | null;
  gatekeeper_doc_type: string | null;
  gatekeeper_confidence: number | null;
  gatekeeper_needs_review: boolean | null;
  gatekeeper_route: string | null;
  intake_status: string | null;
  intake_confirmed_at: string | null;
  intake_confirmed_by: string | null;
  intake_locked_at: string | null;
  created_at: string | null;
  statement_period: string | null;
};

type ProcessingMarkers = {
  run_id: string | null;
  queued_at: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  error: string | null;
  auto_recovered: boolean;
};

type ReviewData = {
  ok: boolean;
  intake_phase: string;
  feature_enabled: boolean;
  documents: IntakeDoc[];
  processing?: ProcessingMarkers;
};

type ConfBand = "LOW" | "MEDIUM" | "HIGH";
type Filter = "all" | "LOW" | "MEDIUM" | "pending";

// ── Helpers ────────────────────────────────────────────────────────────

/** Derive confidence band using shared calibration thresholds (single source of truth). */
function resolveConfBand(c: number | null | undefined): ConfBand {
  if (c != null && c >= CONFIDENCE_THRESHOLDS.HIGH) return "HIGH";
  if (c != null && c >= CONFIDENCE_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

const STATUS_LABELS: Record<string, string> = {
  UPLOADED: "Uploaded",
  CLASSIFIED_PENDING_REVIEW: "Pending Review",
  AUTO_CONFIRMED: "Auto-Confirmed",
  USER_CONFIRMED: "Confirmed",
  LOCKED_FOR_PROCESSING: "Locked",
};

// E1.2: Per-doc blocker labels — each maps to a concrete banker action
const BLOCKER_LABELS: Record<string, string> = {
  needs_confirmation: "Needs Confirmation",
  quality_not_passed: "Quality Failed",
  segmented_parent: "Segmentation Incomplete",
  entity_ambiguous: "Entity Ambiguous",
  unclassified: "Unclassified",
  missing_required_year: "Missing Year",
};

/** Classify HTTP status as transport (server/network) vs business error. */
function isTransportError(status: number): boolean {
  return status >= 500 || status === 0;
}

/** Phase O: Types that require tax_year to produce a valid checklist_key. */
const YEAR_REQUIRED_TYPES = new Set([
  "PERSONAL_TAX_RETURN",
  "BUSINESS_TAX_RETURN",
]);

/** Phase P: Types that require statement_period discriminator for checklist slot. */
const PERIOD_REQUIRED_TYPES = new Set([
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
]);

const DOC_TYPE_OPTIONS = [
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "RENT_ROLL",
  "PERSONAL_FINANCIAL_STATEMENT",
  "PERSONAL_INCOME",
  "SCHEDULE_K1",
  "BANK_STATEMENT",
  "LEASE",
  "INSURANCE",
  "APPRAISAL",
  "OPERATING_AGREEMENT",
  "ARTICLES",
  "W2",
  "1099",
  "OTHER",
];

/** Extract StuckReason from auto-recovery/stuck-recovery error strings. */
const VALID_STUCK_REASONS: StuckReason[] = [
  "queued_never_started", "heartbeat_stale", "overall_timeout", "legacy_no_markers",
];
function extractStuckReason(error: string | null): StuckReason | null {
  if (!error) return null;
  const match = error.match(/(?:auto_recovery|stuck_recovery):\s*(\w+)/);
  if (!match) return null;
  return VALID_STUCK_REASONS.includes(match[1] as StuckReason)
    ? (match[1] as StuckReason)
    : null;
}

// ── Component ──────────────────────────────────────────────────────────

export function IntakeReviewTable({
  dealId,
  onNeedsReview,
  onSubmitted,
}: {
  dealId: string;
  onNeedsReview?: () => void;
  onSubmitted?: () => void;
}) {
  const [data, setData] = useState<ReviewData | null>(null);
  const needsReviewFired = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [submitting, setSubmitting] = useState(false);
  type SubmitPhase = "idle" | "checking" | "confirming";
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [editingDoc, setEditingDoc] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    canonical_type?: string;
    tax_year?: number;
    statement_period?: string;
  }>({});
  // E1.2: Per-doc blocker state — populated on confirmation_blocked response
  const [blockedDocs, setBlockedDocs] = useState<Map<string, string[]>>(new Map());
  const [blockerSummary, setBlockerSummary] = useState<Record<string, number> | null>(null);

  // Phase C: Entity-binding readiness — surfaced from processing-status
  const [entityBindingRequired, setEntityBindingRequired] = useState(false);
  const [unboundEntityScopedSlotCount, setUnboundEntityScopedSlotCount] = useState(0);

  // Safety: attempt scoping (Step A) — monotonic counter to invalidate stale async paths
  const attemptRef = useRef(0);
  const confirmedAttemptRef = useRef(0);
  // Safety: abort controller (Step B) — cancels in-flight fetches on retry/unmount
  const abortRef = useRef<AbortController | null>(null);
  // Safety: phase invalidation (Step D) — detects regression during processing
  const [invalidated, setInvalidated] = useState(false);
  // Safety: polling stop (Step E) — halts polling when stuck timeout fires
  const pollStoppedRef = useRef(false);
  // Safety: submit-in-flight guard — prevents stale poll merges during submit flow
  const submitInFlightRef = useRef(false);

  /** Lightweight console instrumentation (Step G). */
  const logIntake = useCallback(
    (event: string, extra?: Record<string, unknown>) => {
      console.log(`[ui.intake] ${event}`, { dealId, attempt: attemptRef.current, ...extra });
    },
    [dealId],
  );

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/deals/${dealId}/intake/review`, {
        cache: "no-store",
        signal,
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to load intake review data");
        return;
      }
      setData(json);
      setError(null);
      // Fire onNeedsReview once when phase reaches CLASSIFIED_PENDING_CONFIRMATION
      if (
        json?.intake_phase === "CLASSIFIED_PENDING_CONFIRMATION" &&
        !needsReviewFired.current
      ) {
        needsReviewFired.current = true;
        onNeedsReview?.();
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [dealId, onNeedsReview]);

  /** Lightweight status poll — only phase + processing markers, no document list.
   *  Used during CONFIRMED_READY_FOR_PROCESSING to avoid hammering the heavy /review endpoint. */
  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/deals/${dealId}/intake/processing-status`, {
        cache: "no-store",
        signal,
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) return; // Don't overwrite data on error

      // Merge phase + processing markers into existing data (preserve document list).
      // Skip merge if submit is in-flight — prevents stale poll from overwriting
      // the optimistic CONFIRMED_READY_FOR_PROCESSING phase with stale data.
      if (submitInFlightRef.current) return;
      setData((prev) => prev ? {
        ...prev,
        intake_phase: json.intake_phase,
        processing: json.processing,
      } : prev);
      // Phase C: Capture entity-binding readiness from processing-status
      if (json.entity_binding_required != null) {
        setEntityBindingRequired(json.entity_binding_required);
        setUnboundEntityScopedSlotCount(json.unbound_entity_scoped_slot_count ?? 0);
      }
      setError(null);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      // Don't set error on lightweight status poll failure — non-critical
    }
  }, [dealId]);

  // Part 6: Exponential backoff polling — starts fast during processing,
  // backs off to reduce server load, stops after completion.
  // During CONFIRMED_READY_FOR_PROCESSING, polls lightweight /processing-status
  // instead of heavy /review to prevent 500s and reduce server load.
  const pollTickRef = useRef(0);
  const prevPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);

    function getPollInterval(): number {
      if (data?.intake_phase !== "CONFIRMED_READY_FOR_PROCESSING") {
        pollTickRef.current = 0;
        return 8000; // normal idle polling
      }
      // Backoff: 3s → 5s → 15s (capped)
      const tick = pollTickRef.current;
      if (tick < 3) return POLL_INITIAL_MS;
      if (tick < 8) return POLL_BACKOFF_MS;
      return POLL_MAX_MS;
    }

    const interval = setInterval(() => {
      pollTickRef.current += 1;
      if (pollStoppedRef.current) return; // Step E: stop polling when stuck
      if (submitInFlightRef.current) return; // Suppress stale merges during submit

      if (data?.intake_phase === "CONFIRMED_READY_FOR_PROCESSING") {
        // Use lightweight status endpoint during processing
        void refreshStatus(controller.signal);
      } else {
        void refresh(controller.signal);
      }
    }, getPollInterval());

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [refresh, refreshStatus, data?.intake_phase]);

  // Full refresh when processing completes — load the updated document list
  useEffect(() => {
    const phase = data?.intake_phase ?? null;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    if (
      prev === "CONFIRMED_READY_FOR_PROCESSING" &&
      phase != null &&
      phase !== "CONFIRMED_READY_FOR_PROCESSING"
    ) {
      void refresh();
    }
  }, [data?.intake_phase, refresh]);

  // Step B: Abort in-flight submit fetches on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const filteredDocs = useMemo(() => {
    if (!data?.documents) return [];
    if (filter === "all") return data.documents;
    return data.documents.filter((d) => {
      const band = resolveConfBand(d.ai_confidence);
      if (filter === "LOW") return band === "LOW";
      if (filter === "MEDIUM") return band === "MEDIUM";
      if (filter === "pending")
        return (
          d.intake_status === "UPLOADED" ||
          d.intake_status === "CLASSIFIED_PENDING_REVIEW"
        );
      return true;
    });
  }, [data?.documents, filter]);

  const counts = useMemo(() => {
    const docs = data?.documents ?? [];
    return {
      total: docs.length,
      low: docs.filter((d) => resolveConfBand(d.ai_confidence) === "LOW").length,
      medium: docs.filter((d) => resolveConfBand(d.ai_confidence) === "MEDIUM").length,
      pending: docs.filter(
        (d) =>
          d.intake_status === "UPLOADED" ||
          d.intake_status === "CLASSIFIED_PENDING_REVIEW",
      ).length,
    };
  }, [data?.documents]);

  const canSubmit = useMemo(() => {
    if (!data?.documents?.length) return false;
    return !data.documents.some(
      (d) =>
        d.intake_status === "UPLOADED" ||
        d.intake_status === "CLASSIFIED_PENDING_REVIEW",
    );
  }, [data?.documents]);

  const isProcessing =
    data?.intake_phase === "CONFIRMED_READY_FOR_PROCESSING";
  const isComplete =
    data?.intake_phase === "PROCESSING_COMPLETE" ||
    data?.intake_phase === "PROCESSING_COMPLETE_WITH_ERRORS";

  // Part 1+2: Client-side timeout guard — UI-derived stuck state.
  // Computed, not persisted. If processing exceeds MAX_PROCESSING_WINDOW_MS,
  // show amber "taking longer than expected" state instead of spinner.
  const isStuck =
    isProcessing &&
    processingStartedAt !== null &&
    elapsed * 1000 >= MAX_PROCESSING_WINDOW_MS;

  // Track elapsed time during processing
  useEffect(() => {
    if (isProcessing && processingStartedAt === null) {
      setProcessingStartedAt(Date.now());
    }
    if (isComplete) {
      setProcessingStartedAt(null);
    }
  }, [isProcessing, isComplete, processingStartedAt]);

  useEffect(() => {
    if (!isProcessing || processingStartedAt === null) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - processingStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isProcessing, processingStartedAt]);

  // Step E: Stop polling when stuck timeout fires
  useEffect(() => {
    if (isStuck) {
      pollStoppedRef.current = true;
      logIntake("poll.timeout");
    }
  }, [isStuck, logIntake]);

  // Auto-navigate on successful processing completion.
  // Errors stay on page for retry.
  const completionFired = useRef(false);
  useEffect(() => {
    if (
      data?.intake_phase === "PROCESSING_COMPLETE" &&
      !completionFired.current &&
      confirmedAttemptRef.current === attemptRef.current
    ) {
      completionFired.current = true;
      logIntake("poll.terminal", { phase: data.intake_phase });
      onSubmitted?.();
    }
  }, [data?.intake_phase, onSubmitted, logIntake]);

  // Step D: Detect phase regression during processing
  useEffect(() => {
    if (processingStartedAt !== null && data?.intake_phase != null) {
      const phase = data.intake_phase;
      if (phase === "BULK_UPLOADED" || phase === "CLASSIFIED_PENDING_CONFIRMATION") {
        setInvalidated(true);
        setProcessingStartedAt(null);
        logIntake("poll.invalidated", { phase });
      }
    }
  }, [data?.intake_phase, processingStartedAt, logIntake]);

  // Server-side recovery detection — stops client timer when server auto-recovers
  useEffect(() => {
    if (data?.processing?.auto_recovered) {
      setProcessingStartedAt(null);
      pollStoppedRef.current = false;
      logIntake("poll.server_recovery", { reason: data.processing.error });
    }
  }, [data?.processing?.auto_recovered, logIntake]);

  // ── Actions ────────────────────────────────────────────────────────

  async function confirmDoc(docId: string, patch?: { canonical_type?: string; tax_year?: number; statement_period?: string }) {
    try {
      const body: Record<string, unknown> = {};
      if (patch?.canonical_type) body.canonical_type = patch.canonical_type;
      if (patch?.tax_year) body.tax_year = patch.tax_year;
      if (patch?.statement_period) body.statement_period = patch.statement_period;

      const res = await fetch(
        `/api/deals/${dealId}/intake/documents/${docId}/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to confirm document");
        return;
      }
      setEditingDoc(null);
      setEditValues({});
      // E1.2: Clear blocker for this doc on successful confirm
      setBlockedDocs((prev) => {
        const next = new Map(prev);
        next.delete(docId);
        return next;
      });
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Confirm failed");
    }
  }

  /** Parse confirmation_blocked response into per-doc blocker state + error message. */
  function applyBlockerResponse(json: any) {
    const docMap = new Map<string, string[]>();
    for (const bd of json.blocked_documents as Array<{ document_id: string; blockers: string[] }>) {
      docMap.set(bd.document_id, bd.blockers);
    }
    setBlockedDocs(docMap);
    setBlockerSummary(json.summary ?? null);

    const parts: string[] = [];
    const s = json.summary as Record<string, number> | undefined;
    if (s?.needs_confirmation) parts.push(`${s.needs_confirmation} need confirmation`);
    if (s?.quality_not_passed) parts.push(`${s.quality_not_passed} quality failed`);
    if (s?.segmented_parent) parts.push(`${s.segmented_parent} segmentation incomplete`);
    if (s?.entity_ambiguous) parts.push(`${s.entity_ambiguous} entity ambiguous`);
    if (s?.unclassified) parts.push(`${s.unclassified} unclassified`);
    if (s?.missing_required_year) parts.push(`${s.missing_required_year} missing year`);
    setError(parts.length > 0 ? parts.join(" \u2022 ") : "Some documents have issues preventing confirmation.");
  }

  /**
   * Bulletproof submit: dry-run → confirm → stay on page for processing.
   *
   * Safety layers:
   * - Step A: Attempt scoping — stale async paths ignored on retry
   * - Step B: AbortController — cancels fetches on retry/unmount
   * - Step C: Transport vs business error separation
   * - Step F: Double-submit guard
   * - Step G: Console instrumentation
   */
  async function submitToProcessing() {
    // Step F: Double-submit guard (covers rapid clicks before React re-render)
    if (submitting) return;

    // Step A: Attempt scoping — monotonic counter invalidates stale paths
    attemptRef.current += 1;
    const localAttempt = attemptRef.current;

    // Step B: Cancel any prior in-flight fetches
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    // Step E: Clear poll stop on retry
    pollStoppedRef.current = false;
    // Step D: Clear invalidation on retry
    setInvalidated(false);
    // Reset completion guard for new attempt
    completionFired.current = false;

    setSubmitting(true);
    submitInFlightRef.current = true;
    setError(null);
    setBlockedDocs(new Map());
    setBlockerSummary(null);

    try {
      // ── Step 1: Dry-run — proactive blocker check ──────────────────
      if (attemptRef.current !== localAttempt) return;
      setSubmitPhase("checking");
      logIntake("dry_run.start");

      const dryRes = await fetch(
        `/api/deals/${dealId}/intake/confirm?dry_run=true`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
          signal,
        },
      );
      const dryJson = await dryRes.json();

      if (!dryRes.ok || !dryJson?.ok) {
        if (attemptRef.current !== localAttempt) return;

        if (dryJson?.error === "confirmation_blocked" && dryJson?.blocked_documents) {
          applyBlockerResponse(dryJson);
          logIntake("dry_run.blocked", { count: dryJson.blocked_documents.length });
        } else if (dryJson?.error === "intake_already_confirmed") {
          // Already confirmed — skip to polling; processing is in progress
          logIntake("confirm.already_confirmed_409");
          setProcessingStartedAt(Date.now());
          setElapsed(0);
          confirmedAttemptRef.current = localAttempt;
          await refresh(signal);
          return;
        } else if (isTransportError(dryRes.status)) {
          logIntake("dry_run.transport_error", { status: dryRes.status });
          setError("Couldn\u2019t reach server. Please retry.");
        } else {
          setError(dryJson?.error ?? "Pre-check failed");
        }
        return;
      }

      // ── Step 2: Clean — proceed to confirm ─────────────────────────
      if (attemptRef.current !== localAttempt) return;
      setSubmitPhase("confirming");
      logIntake("confirm.start");

      const res = await fetch(`/api/deals/${dealId}/intake/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        signal,
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        if (attemptRef.current !== localAttempt) return;

        // Race condition defense: blockers appeared between dry-run and confirm
        if (json?.error === "confirmation_blocked" && json?.blocked_documents) {
          applyBlockerResponse(json);
        } else if (json?.error === "intake_already_confirmed") {
          // Another tab confirmed — skip to polling
          logIntake("confirm.already_confirmed_409");
          setProcessingStartedAt(Date.now());
          setElapsed(0);
          confirmedAttemptRef.current = localAttempt;
          await refresh(signal);
          return;
        } else if (isTransportError(res.status)) {
          setError("Couldn\u2019t reach server. Please retry.");
        } else {
          const errMsg =
            json?.error === "quality_gate_failed"
              ? "Some document(s) failed automated quality checks. Please re-upload a clearer copy."
              : json?.error === "pending_documents_exist"
              ? `${json.pending_count ?? "Some"} document(s) still need confirmation before processing.`
              : json?.error ?? "Confirmation failed";
          setError(errMsg);
        }
        return;
      }

      // ── Step 3: Success — enter processing state ───────────────────
      // Do NOT call onSubmitted() — stay on page; polling detects completion.
      if (attemptRef.current !== localAttempt) return;
      logIntake("confirm.success");
      setBlockedDocs(new Map());
      setBlockerSummary(null);
      // Optimistically reflect server-committed phase before setting processingStartedAt.
      // The confirm route already persisted CONFIRMED_READY_FOR_PROCESSING in the DB.
      // Without this, React flushes at the await boundary with processingStartedAt !== null
      // but intake_phase still "CLASSIFIED_PENDING_CONFIRMATION" (stale), which deterministically
      // triggers the invalidation effect (Step D). This mirrors committed DB state — no lying.
      setData((prev) =>
        prev
          ? { ...prev, intake_phase: "CONFIRMED_READY_FOR_PROCESSING" }
          : prev,
      );
      setProcessingStartedAt(Date.now());
      setElapsed(0);
      confirmedAttemptRef.current = localAttempt;
      await refresh(signal);
    } catch (err: any) {
      // Step B: AbortError = silent return (retry or unmount cancelled this)
      if (err?.name === "AbortError") return;
      if (attemptRef.current !== localAttempt) return;
      // Step C: Network error — distinct from business errors
      setError("Network error \u2014 please check your connection and retry.");
      setProcessingStartedAt(null);
      submitInFlightRef.current = false;
    } finally {
      // Only cleanup if this is still the active attempt
      if (attemptRef.current === localAttempt) {
        setSubmitPhase("idle");
        setSubmitting(false);
        submitInFlightRef.current = false;
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-white/40 text-sm p-4">
        Loading intake review...
      </div>
    );
  }

  if (!data?.feature_enabled) {
    return null;
  }

  // Step D: Phase regression — intake snapshot invalidated during processing
  if (invalidated) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-400 text-[20px]">
              sync_problem
            </span>
            <div>
              <div className="text-amber-400 text-sm font-medium">
                Intake snapshot invalidated
              </div>
              <div className="text-white/40 text-xs mt-0.5">
                New documents were uploaded or classifications changed. Please re-confirm to process.
              </div>
            </div>
          </div>
          <button
            onClick={() => { setInvalidated(false); void submitToProcessing(); }}
            disabled={submitting}
            className="ml-4 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            Re-run check
          </button>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    // Part 1: Stuck state — amber UI when elapsed > MAX_PROCESSING_WINDOW_MS
    if (isStuck) {
      return (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-amber-400 text-[20px]">
                schedule
              </span>
              <div>
                <div className="text-amber-400 text-sm font-medium">
                  Processing is taking longer than expected
                </div>
                <div className="text-white/40 text-xs mt-0.5">
                  {timeStr} elapsed — Buddy is still working. If this persists, retry below.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { pollStoppedRef.current = false; void refresh(); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/50 hover:bg-white/10 transition-colors"
              >
                Continue polling
              </button>
              <button
                onClick={() => void submitToProcessing()}
                disabled={submitting}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
              >
                {submitting ? "Retrying..." : "Retry"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Part 9: UX copy — institutional framing with run-marker awareness
    const processingLabel = (() => {
      const m = data?.processing;
      if (!m?.queued_at) return "Buddy is processing your documents securely";
      if (!m.started_at) return "Queued for processing...";
      if (m.last_heartbeat_at) return "Buddy is processing your documents securely";
      return "Processing started...";
    })();
    const processingDetail = (() => {
      const m = data?.processing;
      if (!m?.queued_at) return `Matching, extracting, and computing spreads — ${timeStr} elapsed`;
      if (!m.started_at) return `Waiting for processing to begin — ${timeStr} elapsed`;
      return `Matching, extracting, and computing spreads — ${timeStr} elapsed`;
    })();

    return (
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
        <div className="flex items-center gap-3">
          <div className="relative h-5 w-5 flex-shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-blue-500/30" />
            <div className="absolute inset-0 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          </div>
          <div>
            <div className="text-blue-400 text-sm font-medium">
              {processingLabel}
            </div>
            <div className="text-white/40 text-xs mt-0.5">
              {processingDetail}
            </div>
          </div>
        </div>
        <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full bg-blue-500/40 rounded-full animate-pulse" style={{ width: "100%" }} />
        </div>
      </div>
    );
  }

  if (isComplete) {
    const hasErrors = data?.intake_phase === "PROCESSING_COMPLETE_WITH_ERRORS";
    const processingError = data?.processing?.error ?? null;
    const wasAutoRecovered = data?.processing?.auto_recovered ?? false;
    return (
      <div className={cn(
        "rounded-xl border p-4",
        hasErrors
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-emerald-500/20 bg-emerald-500/5",
      )}>
        <div className="flex items-center justify-between">
          <div className={cn(
            "flex items-center gap-2 text-sm font-medium",
            hasErrors ? "text-amber-400" : "text-emerald-400",
          )}>
            <span className="material-symbols-outlined text-[16px]">
              {hasErrors ? "warning" : "check_circle"}
            </span>
            {hasErrors
              ? wasAutoRecovered
                ? (() => {
                    const reason = extractStuckReason(processingError);
                    return reason
                      ? getStuckReasonUx(reason).headline
                      : "Processing stalled and was auto-recovered";
                  })()
                : "Processing complete — some documents had issues"
              : "Intake confirmed and processing complete"}
          </div>
          {hasErrors && (
            <button
              onClick={() => void submitToProcessing()}
              disabled={submitting}
              className="ml-4 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
            >
              {submitting
                ? "Retrying..."
                : wasAutoRecovered
                  ? (() => {
                      const reason = extractStuckReason(processingError);
                      return reason ? getStuckReasonUx(reason).cta : "Retry";
                    })()
                  : "Retry"}
            </button>
          )}
        </div>
        {hasErrors && processingError && (
          <div className="mt-2 text-xs text-white/40 font-mono truncate">
            {scrubPii(processingError)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
          Intake Review
        </h3>
        <div className="flex items-center gap-2">
          {counts.low > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400">
              {counts.low} low confidence
            </span>
          )}
          {counts.medium > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              {counts.medium} moderate
            </span>
          )}
          {counts.pending > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
              {counts.pending} pending
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Phase C: Entity-binding required callout */}
      {entityBindingRequired && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-400 text-[20px]">
              link_off
            </span>
            <div className="flex-1">
              <div className="text-amber-400 text-sm font-medium">
                Entity-scoped slots need binding
              </div>
              <div className="text-white/40 text-xs mt-0.5">
                {unboundEntityScopedSlotCount} unbound entity-scoped slot{unboundEntityScopedSlotCount !== 1 ? "s" : ""} detected on this multi-entity deal.
                Bind slots to entities before auto-match can safely proceed.
              </div>
            </div>
            <a
              href={`/deals/${dealId}/intake/slots`}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors whitespace-nowrap"
            >
              Bind Slots
            </a>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-1">
        {(["all", "LOW", "MEDIUM", "pending"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md transition-colors",
              filter === f
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/60 hover:bg-white/5",
            )}
          >
            {f === "all" ? `All (${counts.total})` :
             f === "LOW" ? `Low (${counts.low})` :
             f === "MEDIUM" ? `Medium (${counts.medium})` :
             `Pending (${counts.pending})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/40 border-b border-white/10">
              <th className="text-left py-2 px-2 font-medium">Filename</th>
              <th className="text-left py-2 px-2 font-medium">Type</th>
              <th className="text-left py-2 px-2 font-medium">Year</th>
              <th className="text-center py-2 px-2 font-medium">Confidence</th>
              <th className="text-center py-2 px-2 font-medium">Status</th>
              <th className="text-right py-2 px-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocs.map((doc) => {
              const isEditing = editingDoc === doc.id;

              return (
                <tr
                  key={doc.id}
                  className="border-b border-white/5 hover:bg-white/[0.02]"
                >
                  <td className="py-2 px-2 text-white/70 max-w-[200px] truncate">
                    {doc.original_filename ?? "—"}
                  </td>
                  <td className="py-2 px-2">
                    {isEditing ? (
                      <select
                        value={editValues.canonical_type ?? doc.canonical_type ?? ""}
                        onChange={(e) =>
                          setEditValues((prev) => ({
                            ...prev,
                            canonical_type: e.target.value,
                          }))
                        }
                        className="bg-gray-900 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white w-full"
                      >
                        <option value="" className="bg-gray-900 text-white">Select type...</option>
                        {DOC_TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t} className="bg-gray-900 text-white">
                            {t.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-white/60">
                        {doc.canonical_type?.replace(/_/g, " ") ??
                          doc.document_type?.replace(/_/g, " ") ??
                          "Unclassified"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    {isEditing ? (
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min={1990}
                          max={2100}
                          value={editValues.tax_year ?? doc.doc_year ?? ""}
                          onChange={(e) =>
                            setEditValues((prev) => ({
                              ...prev,
                              tax_year: e.target.value
                                ? parseInt(e.target.value, 10)
                                : undefined,
                            }))
                          }
                          className="bg-gray-900 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white w-16"
                        />
                        {PERIOD_REQUIRED_TYPES.has(editValues.canonical_type ?? "") && (
                          <select
                            value={editValues.statement_period ?? ""}
                            onChange={(e) =>
                              setEditValues((prev) => ({
                                ...prev,
                                statement_period: e.target.value || undefined,
                              }))
                            }
                            className="bg-gray-900 border border-white/10 rounded px-1 py-0.5 text-[10px] text-white w-20"
                          >
                            <option value="">Period…</option>
                            {(editValues.canonical_type === "INCOME_STATEMENT"
                              ? [["YTD", "YTD"], ["ANNUAL", "Annual"]]
                              : [["CURRENT", "Current"], ["HISTORICAL", "Historical"]]
                            ).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    ) : (
                      <span className="text-white/60">
                        {doc.doc_year ?? "—"}
                        {doc.statement_period && (
                          <span className="text-white/30 text-[9px] ml-1">
                            {doc.statement_period}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <ConfidenceBadge
                      confidence={doc.ai_confidence}
                      confirmed={doc.match_source === "manual" || doc.match_source === "manual_confirmed"}
                      unreviewed={
                        doc.match_source !== "manual" &&
                        doc.match_source !== "manual_confirmed" &&
                        (
                          doc.intake_status === "UPLOADED" ||
                          doc.intake_status === "CLASSIFIED_PENDING_REVIEW" ||
                          doc.ai_confidence == null ||
                          doc.gatekeeper_needs_review === true ||
                          doc.gatekeeper_route === "NEEDS_REVIEW"
                        )
                      }
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      <span className="text-white/50">
                        {STATUS_LABELS[doc.intake_status ?? ""] ?? doc.intake_status ?? "—"}
                      </span>
                      {/* E1.2: Per-doc blocker badges */}
                      {blockedDocs.has(doc.id) &&
                        blockedDocs.get(doc.id)!.map((code) => (
                          <span
                            key={code}
                            className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap",
                              code === "quality_not_passed" || code === "unclassified"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-amber-500/20 text-amber-400",
                            )}
                          >
                            {BLOCKER_LABELS[code] ?? code}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    {isEditing ? (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => {
                            setEditingDoc(null);
                            setEditValues({});
                          }}
                          className="text-white/40 hover:text-white/60 px-1.5 py-0.5 rounded text-[10px]"
                        >
                          Cancel
                        </button>
                        {(() => {
                          const editType = editValues.canonical_type ?? "";
                          const needsYear = YEAR_REQUIRED_TYPES.has(editType) && !editValues.tax_year;
                          const needsPeriod = PERIOD_REQUIRED_TYPES.has(editType) && !editValues.statement_period;
                          const blocked = needsYear || needsPeriod;
                          const hint = needsYear ? "Year required" : needsPeriod ? "Period required" : null;
                          return (
                            <>
                              {hint && (
                                <span className="text-amber-400 text-[9px] whitespace-nowrap">{hint}</span>
                              )}
                              <button
                                onClick={() => void confirmDoc(doc.id, editValues)}
                                disabled={blocked}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-medium",
                                  blocked
                                    ? "bg-white/5 text-white/20 cursor-not-allowed"
                                    : "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30",
                                )}
                              >
                                Save
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => {
                            setEditingDoc(doc.id);
                            setEditValues({
                              canonical_type: doc.canonical_type ?? undefined,
                              tax_year: doc.doc_year ?? undefined,
                              statement_period: doc.statement_period ?? undefined,
                            });
                          }}
                          className="text-white/40 hover:text-white/60 px-1.5 py-0.5 rounded text-[10px]"
                        >
                          Edit
                        </button>
                        {(doc.intake_status === "CLASSIFIED_PENDING_REVIEW" ||
                          doc.intake_status === "UPLOADED") && (() => {
                          const docType = doc.canonical_type ?? "";
                          const needsYear = YEAR_REQUIRED_TYPES.has(docType) && !doc.doc_year;
                          const needsPeriod = PERIOD_REQUIRED_TYPES.has(docType) && !doc.statement_period;
                          const blocked = needsYear || needsPeriod;
                          const hint = needsYear ? "Year required" : needsPeriod ? "Period required" : null;
                          return (
                            <>
                              {hint && (
                                <span className="text-amber-400 text-[9px] whitespace-nowrap">{hint}</span>
                              )}
                              <button
                                onClick={() => void confirmDoc(doc.id)}
                                disabled={blocked}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-medium",
                                  blocked
                                    ? "bg-white/5 text-white/20 cursor-not-allowed"
                                    : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30",
                                )}
                              >
                                Confirm
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredDocs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-white/30">
                  No documents match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Submit CTA */}
      <div className="flex justify-end pt-2">
        <button
          onClick={() => void submitToProcessing()}
          disabled={!canSubmit || submitting}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
            canSubmit && !submitting
              ? "bg-blue-600 text-white hover:bg-blue-500"
              : "bg-white/5 text-white/20 cursor-not-allowed",
          )}
        >
          {submitting && (
            <span className="animate-spin material-symbols-outlined text-[16px]">
              progress_activity
            </span>
          )}
          {submitPhase === "checking"
            ? "Checking documents\u2026"
            : submitPhase === "confirming"
            ? "Confirming & starting\u2026"
            : submitting
            ? "Processing\u2026"
            : "Submit to Processing"}
        </button>
      </div>
    </div>
  );
}
