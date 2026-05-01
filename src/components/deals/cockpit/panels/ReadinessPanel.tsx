"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { useCockpitStateContext } from "@/hooks/useCockpitState";
import { STAGE_LABELS, type LifecycleStage } from "@/buddy/lifecycle/model";
import { PrimaryCTAButton } from "./PrimaryCTAButton";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

const STAGE_ORDER: LifecycleStage[] = [
  "intake_created", "docs_requested", "docs_in_progress", "docs_satisfied",
  "underwrite_ready", "underwrite_in_progress", "committee_ready",
  "committee_decisioned", "closing_in_progress", "closed",
];


function DerivedFactDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          ok ? "bg-emerald-400" : "bg-amber-400/50",
        )}
      />
      <span className={cn("text-xs", ok ? "text-white/70" : "text-white/40")}>{label}</span>
    </div>
  );
}

// ── Intake Processing Kick (self-contained) ────────────────────────────────

function IntakeProcessingKick({ dealId }: { dealId: string }) {
  const [status, setStatus] = useState<{
    intake_phase: string | null;
    outbox_stalled: boolean;
    outbox_created_at: string | null;
  } | null>(null);
  const [kicking, setKicking] = useState(false);
  const [kickResult, setKickResult] = useState<string | null>(null);
  // now() held in state so age stays stable across re-renders until the tick
  const [nowMs, setNowMs] = useState<number>(0);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/deals/${dealId}/intake/processing-status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        setStatus({
          intake_phase: data.intake_phase ?? null,
          outbox_stalled: data.outbox_stalled ?? false,
          outbox_created_at: data.latest_outbox?.created_at ?? null,
        });
      } catch {
        // Ignore — this is best-effort
      }
    }

    poll();
    const interval = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dealId]);

  // Only show when processing outbox is stalled (server-authoritative)
  if (!status) return null;
  if (status.intake_phase !== "CONFIRMED_READY_FOR_PROCESSING") return null;
  if (!status.outbox_stalled) return null;

  const age = status.outbox_created_at && nowMs > 0
    ? nowMs - new Date(status.outbox_created_at).getTime()
    : 0;

  async function handleKick() {
    setKicking(true);
    setKickResult(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/intake/processing/kick`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setKickResult("Processing re-enqueued. It will start shortly.");
      } else {
        setKickResult(data.error ?? "Kick failed");
      }
    } catch {
      setKickResult("Network error");
    } finally {
      setKicking(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-amber-300/80">
          Processing stalled ({Math.round(age / 1000)}s)
        </span>
        <button
          onClick={handleKick}
          disabled={kicking}
          className={cn(
            "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
            kicking
              ? "bg-amber-500/10 text-amber-300/40 cursor-wait"
              : "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30",
          )}
        >
          {kicking ? "Kicking..." : "Run Processing Now"}
        </button>
      </div>
      {kickResult && (
        <p className="text-[10px] text-amber-300/60">{kickResult}</p>
      )}
    </div>
  );
}

// ── Main ReadinessPanel ─────────────────────────────────────────────────────

type Props = {
  dealId: string;
  isAdmin?: boolean;
  onServerAction?: (action: string) => void;
  onAdvance?: () => void;
};

// Category labels for cockpit-state readiness categories
const CATEGORY_LABELS: Record<string, string> = {
  documents: "Documents",
  loan_request: "Loan Request",
  spreads: "Spreads",
  financials: "Financial Snapshot",
  pricing_quote: "Pricing",
  decision: "Decision",
  underwriting: "Underwriting",
  risk_pricing: "Risk & Pricing",
  ai_pipeline: "AI Pipeline",
  pricing_setup: "Pricing Setup",
};

export function ReadinessPanel({ dealId, isAdmin, onServerAction, onAdvance }: Props) {
  const router = useRouter();
  const { lifecycleState, isInitialLoading, error } = useCockpitDataContext();
  const { state: cockpitState, refetch: refetchCockpitState } = useCockpitStateContext();
  const [bankerExplainerOpen, setBankerExplainerOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const autoHealAttempted = useRef(false);
  const [suppressedBlockerCodes, setSuppressedBlockerCodes] = useState<Set<string>>(new Set());
  const [snapshotGeneratedLocally, setSnapshotGeneratedLocally] = useState(false);

  // Clear blocker suppression when lifecycle state refreshes with new data
  const blockerFingerprint = (lifecycleState?.blockers ?? []).map((b: any) => b.code).sort().join(",");
  useEffect(() => {
    if (suppressedBlockerCodes.size > 0) {
      setSuppressedBlockerCodes(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockerFingerprint]);

  // Once the server confirms the snapshot exists, clear the local override —
  // the blocker will have been removed from server data at that point.
  const derived = lifecycleState?.derived;
  useEffect(() => {
    if (snapshotGeneratedLocally && derived?.financialSnapshotExists) {
      setSnapshotGeneratedLocally(false);
    }
  }, [snapshotGeneratedLocally, derived?.financialSnapshotExists]);

  const handleServerAction = useCallback(
    async (action: string) => {
      if (onServerAction) {
        onServerAction(action);
        return;
      }

      setBusyAction(action);
      setActionError(null);

      try {
        // Route action-specific endpoints
        if (action === "ai_pipeline.process") {
          const res = await fetch(`/api/deals/${dealId}/artifacts/process`, { method: "POST" });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            setActionError(body?.error ?? `Processing failed (${res.status})`);
            return;
          }
          refetchCockpitState(); // Phase 67: refresh all panels
          onAdvance?.();
          return;
        }

        if (action === "financial_snapshot.recompute") {
          let res = await fetch(`/api/deals/${dealId}/financial-snapshot/recompute`, {
            method: "POST",
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            const reasons: string[] = body?.reasons ?? (body?.reason ? [body.reason] : []);

            if (res.status === 422 && body?.error === "SNAPSHOT_BLOCKED") {
              const hasNoFacts = reasons.includes("NO_FACTS");
              const hasLoanIncomplete = reasons.includes("LOAN_REQUEST_INCOMPLETE");

              // Auto-heal: only attempt if NO_FACTS is the sole blocker and we haven't tried yet
              if (hasNoFacts && !hasLoanIncomplete && !autoHealAttempted.current) {
                autoHealAttempted.current = true;

                // Run AI extraction on classified artifacts (writes real financial facts)
                const extRes = await fetch(
                  `/api/deals/${dealId}/financial-facts/extract-from-classified`,
                  { method: "POST" },
                ).catch(() => null);
                const extBody = await extRes?.json().catch(() => null);

                if (extBody?.ok && extBody.factsWritten > 0) {
                  res = await fetch(`/api/deals/${dealId}/financial-snapshot/recompute`, {
                    method: "POST",
                  });
                  if (res.ok) {
                    onAdvance?.();
                    return;
                  }
                }

                setActionError(
                  "No financial data extracted yet. Upload and classify financial documents, then try again.",
                );
                return;
              }

              // Show human-readable message from server (covers LOAN_REQUEST_INCOMPLETE etc.)
              setActionError(body?.message ?? "Snapshot blocked. Resolve issues and try again.");
              return;
            }

            if (res.status === 409) {
              setActionError("Spreads are still generating. Please wait and try again.");
              return;
            }
            const msg = body?.error ?? `Snapshot failed (${res.status})`;
            console.error("[ReadinessPanel] financial_snapshot.recompute failed:", res.status, body);
            setActionError(msg);
            return;
          }
          autoHealAttempted.current = false; // Reset on success for future attempts
          setSnapshotGeneratedLocally(true);
          refetchCockpitState(); // Phase 67: refresh all panels
          onAdvance?.();
          return;
        }

        // Default: call the lifecycle server action endpoint
        const res = await fetch(`/api/deals/${dealId}/lifecycle/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          console.error("[ReadinessPanel] lifecycle/action failed:", res.status, body);
          setActionError(body?.error ?? `Action failed (${res.status})`);
        }
      } catch (err) {
        console.error("[ReadinessPanel] action error:", err);
        setActionError("Network error — please retry");
      } finally {
        setBusyAction(null);
      }
    },
    [dealId, onServerAction, onAdvance],
  );

  const blockers = (lifecycleState?.blockers ?? []).filter((b: any) => {
    if (suppressedBlockerCodes.has(b.code)) return false;
    if (snapshotGeneratedLocally && b.code === "financial_snapshot_missing") return false;
    return true;
  });
  const stage = lifecycleState?.stage;

  // Compute overall progress from stage position
  const stageIdx = stage ? STAGE_ORDER.indexOf(stage) : 0;
  const stagePct = Math.round(((stageIdx + 1) / STAGE_ORDER.length) * 100);

  // Document readiness (gatekeeper-authoritative)
  const primaryPct = derived?.documentsReadinessPct ?? 0;
  const primaryReady = derived?.documentsReady ?? false;

  // Skeleton state while initial data loads
  if (isInitialLoading) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-white/20 text-[18px] animate-pulse">hourglass_empty</span>
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">Readiness</span>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="h-10 rounded-xl bg-white/5 animate-pulse" />
          <div className="h-2 rounded-full bg-white/5 animate-pulse" />
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 rounded bg-white/5 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Persistent error after retries — show error with retry
  if (error && !lifecycleState) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400 text-[18px]">cloud_off</span>
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">Readiness</span>
          </div>
        </div>
        <div className="p-4 text-center space-y-2">
          <p className="text-xs text-white/40">Unable to load deal data</p>
          <p className="text-[10px] text-white/30">Retrying automatically...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-400 text-[18px]">
              {(cockpitState?.blockers.length ?? blockers.length) > 0 ? "warning" : "verified"}
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">
              Readiness
            </span>
          </div>
          {stage && (
            <span className="text-[10px] text-white/40 font-mono">
              {STAGE_LABELS[stage] || stage}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Primary CTA */}
        <PrimaryCTAButton
          dealId={dealId}
          onServerAction={handleServerAction}
          onAdvance={onAdvance}
        />

        {/* Phase 67: Canonical readiness from cockpit-state */}
        {cockpitState ? (
          <>
            {/* Readiness percent bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-white/50">
                <span>Overall Readiness</span>
                <span>{cockpitState.readiness.percent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    cockpitState.readiness.percent >= 100 ? "bg-emerald-400" : "bg-blue-400",
                  )}
                  style={{ width: `${cockpitState.readiness.percent}%` }}
                />
              </div>
            </div>

            {/* Readiness categories from cockpit-state */}
            <div className="space-y-1">
              {cockpitState.readiness.categories.map((cat) => {
                const isComplete = cat.status === "complete";
                const isBlocking = cat.status === "blocking";
                return (
                  <div
                    key={cat.code}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <DerivedFactDot
                        label={CATEGORY_LABELS[cat.code] ?? cat.code}
                        ok={isComplete}
                      />
                    </div>
                    <span className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-medium",
                      isComplete ? "bg-emerald-500/20 text-emerald-300" :
                      isBlocking ? "bg-red-500/20 text-red-300" :
                      "bg-amber-500/20 text-amber-300",
                    )}>
                      {isComplete ? "✓ Complete" : isBlocking ? "✗ Blocking" : "○ Warning"}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : derived ? (
          /* Fallback to lifecycle derived facts when cockpit-state hasn't loaded */
          <div className="grid grid-cols-2 gap-2">
            <DerivedFactDot label="Documents" ok={derived.documentsReady} />
            <DerivedFactDot label="AI Pipeline" ok={derived.aiPipelineComplete} />
            <DerivedFactDot label="Spreads" ok={derived.spreadsComplete} />
            <DerivedFactDot label="Pricing Setup" ok={derived.hasPricingAssumptions} />
            <DerivedFactDot label="Loan Request" ok={derived.hasSubmittedLoanRequest} />
            <DerivedFactDot label="Financials" ok={derived.financialSnapshotExists} />
            <DerivedFactDot label="Risk Pricing" ok={derived.riskPricingFinalized} />
            <DerivedFactDot label="Pricing Quote" ok={derived.pricingQuoteReady} />
            <DerivedFactDot label="Underwriting" ok={derived.underwriteStarted} />
            <DerivedFactDot label="Decision" ok={derived.decisionPresent} />
          </div>
        ) : null}

        {/* Credit Memo CTA — visible when financial snapshot exists */}
        {derived?.financialSnapshotExists && (
          <Link
            href={`/credit-memo/${dealId}/canonical`}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white/80 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">description</span>
            <span className="font-medium">View Credit Memo</span>
            <span className="ml-auto text-[10px] text-white/30">Auto-populated</span>
          </Link>
        )}

        {/* Phase 67: Canonical blockers from cockpit-state */}
        {cockpitState && cockpitState.blockers.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">
              Blockers ({cockpitState.blockers.length})
            </div>
            {cockpitState.blockers.map((blocker, idx) => (
              <div
                key={`${blocker.code}-${idx}`}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  blocker.severity === "warning"
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-red-500/20 bg-red-500/5",
                )}
              >
                <div className="text-xs font-medium text-white/80">
                  {blocker.title}
                </div>
                {blocker.details.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {blocker.details.map((detail, j) => (
                      <li key={j} className="text-[10px] text-white/50">
                        {detail}
                      </li>
                    ))}
                  </ul>
                )}
                {blocker.actionLabel && (
                  <button
                    className="mt-1.5 text-[10px] text-blue-400 hover:text-blue-300 font-medium"
                    onClick={() => {
                      // Route action based on blocker code.
                      // loan_request_* is UI-navigation, not a server action: jump to the
                      // cockpit Setup tab where LoanRequestsSection lives, then scroll to
                      // the tab panel. (Pre-fix: handleServerAction("loan_request.open")
                      // posted an unknown action and silently failed.)
                      if (
                        blocker.code === "loan_request_missing" ||
                        blocker.code === "loan_request_incomplete"
                      ) {
                        router.push(`/deals/${dealId}/cockpit?tab=setup`);
                        requestAnimationFrame(() => {
                          try {
                            document
                              .getElementById("secondary-tabs-panel")
                              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                          } catch {
                            /* DOM may be unmounted mid-navigation */
                          }
                        });
                      } else if (blocker.code.startsWith("required_documents")) {
                        window.location.hash = "#cockpit-documents";
                      } else if (blocker.code.includes("review")) {
                        window.location.href = `/deals/${dealId}/documents`;
                      }
                    }}
                  >
                    {blocker.actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {actionError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
            {actionError}
          </div>
        )}

        {/* Intake processing kick — visible when processing is stalled */}
        <IntakeProcessingKick dealId={dealId} />

        {/* Banker explainer */}
        {derived && (
          <div className="border-t border-white/5 pt-3">
            <button
              onClick={() => setBankerExplainerOpen(!bankerExplainerOpen)}
              className="w-full flex items-center justify-between text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              <span>Explain like I&apos;m a banker</span>
              <span
                className="material-symbols-outlined text-[14px] transition-transform"
                style={{ transform: bankerExplainerOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                expand_more
              </span>
            </button>

            {bankerExplainerOpen && (
              <div className="mt-3 space-y-3 text-xs text-white/50">
                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3 space-y-2">
                  <div className="font-semibold text-white/70">What Buddy has done</div>
                  <ul className="space-y-1">
                    <li className="flex items-start gap-2">
                      <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", (cockpitState?.readiness.categories.find(c => c.code === "documents")?.status === "complete" || derived.documentsReady) ? "bg-emerald-400" : "bg-amber-400/50")} />
                      <div>
                        {cockpitState?.readiness.categories.find(c => c.code === "documents")?.status === "complete" || derived.documentsReady
                          ? "All required documents received and matched"
                          : `${cockpitState?.readiness.percent ?? Math.round(primaryPct)}% of required documents received`}
                      </div>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={cn("w-1.5 h-1.5 rounded-full", derived.financialSnapshotExists ? "bg-emerald-400" : "bg-amber-400/50")} />
                      {derived.financialSnapshotExists
                        ? "Financial snapshot generated"
                        : "Financial snapshot not yet generated"}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={cn("w-1.5 h-1.5 rounded-full", derived.underwriteStarted ? "bg-emerald-400" : "bg-amber-400/50")} />
                      {derived.underwriteStarted
                        ? "Underwriting started"
                        : "Underwriting not yet started"}
                    </li>
                  </ul>
                </div>

                {cockpitState && cockpitState.blockers.length > 0 && (
                  <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3 space-y-2">
                    <div className="font-semibold text-white/70">Why it matters</div>
                    <p>
                      Buddy needs{" "}
                      {cockpitState.blockers.map((b) => b.title.toLowerCase()).join(", ")}.
                      Once resolved, the deal advances automatically.
                    </p>
                  </div>
                )}

                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                  <div className="font-semibold text-white/70 mb-1">Progress</div>
                  <div className="flex items-center gap-4 text-[10px] font-mono">
                    <span>Stage: {stageIdx + 1}/{STAGE_ORDER.length}</span>
                    <span>Ready: {cockpitState?.readiness.percent ?? Math.round(primaryPct)}%</span>
                    <span>Blockers: {cockpitState?.blockers.length ?? blockers.length}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
