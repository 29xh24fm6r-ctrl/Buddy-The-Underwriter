"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
// Import from client-safe module to avoid server-only code in client components
import type { LifecycleState, LifecycleStage, LifecycleBlocker } from "@/buddy/lifecycle/client";
import type { ServerActionType } from "@/buddy/lifecycle/client";
import {
  STAGE_LABELS,
  getNextAction,
  getBlockerFixAction,
  getNextActionIcon,
} from "@/buddy/lifecycle/client";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type Props = {
  dealId: string;
  initialState: LifecycleState | null;
  /** Whether the lifecycle data is available/reliable. If false, shows degraded UI. */
  available?: boolean;
};

/**
 * Check if state indicates lifecycle is unavailable (route-level or derive-level errors).
 */
function isLifecycleUnavailable(state: LifecycleState | null): boolean {
  if (!state) return true;
  // Check for infrastructure/route errors in blockers
  const errorCodes = [
    "route_error",
    "params_error",
    "validation_error",
    "access_error",
    "derive_error",
    "unexpected_error",
    "serialization_error",
    "internal_error",
    "data_fetch_failed",
  ];
  return state.blockers.some((b) => errorCodes.includes(b.code));
}

/**
 * Extract correlation ID from state for debugging.
 */
function getCorrelationId(state: LifecycleState | null): string | null {
  if (!state) return null;
  // Check derived first
  if ((state.derived as any)?.correlationId) {
    return (state.derived as any).correlationId;
  }
  // Check blocker evidence
  for (const blocker of state.blockers) {
    if (blocker.evidence?.correlationId) {
      return blocker.evidence.correlationId as string;
    }
  }
  return null;
}

const STAGE_ORDER: LifecycleStage[] = [
  "intake_created",
  "docs_requested",
  "docs_in_progress",
  "docs_satisfied",
  "underwrite_ready",
  "underwrite_in_progress",
  "committee_ready",
  "committee_decisioned",
  "closing_in_progress",
  "closed",
];

function getStageColor(stage: LifecycleStage): string {
  switch (stage) {
    case "intake_created":
      return "bg-slate-500/20 text-slate-300 border-slate-400/30";
    case "docs_requested":
    case "docs_in_progress":
      return "bg-sky-500/20 text-sky-300 border-sky-400/30";
    case "docs_satisfied":
    case "underwrite_ready":
      return "bg-blue-500/20 text-blue-300 border-blue-400/30";
    case "underwrite_in_progress":
      return "bg-amber-500/20 text-amber-300 border-amber-400/30";
    case "committee_ready":
    case "committee_decisioned":
      return "bg-purple-500/20 text-purple-300 border-purple-400/30";
    case "closing_in_progress":
      return "bg-orange-500/20 text-orange-300 border-orange-400/30";
    case "closed":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-400/30";
    case "workout":
      return "bg-red-500/20 text-red-300 border-red-400/30";
    default:
      return "bg-white/10 text-white/70 border-white/20";
  }
}

/**
 * Get a banker-friendly explanation for why a blocker matters.
 * These help bankers answer "Why does Buddy need this?" to borrowers.
 */
function getBankerExplanation(blocker: LifecycleBlocker): string {
  switch (blocker.code) {
    case "gatekeeper_docs_incomplete":
      return "Required documents are still missing. The AI readiness engine tracks which tax returns, financial statements, and other core documents have been received.";
    case "gatekeeper_docs_need_review":
      return "Some documents could not be confidently classified by AI. A banker needs to review and confirm the document type before they count toward readiness.";
    case "financial_snapshot_missing":
      return "The financial snapshot consolidates all borrower data into standardized metrics (DSCR, LTV, etc.) that our credit policy requires for underwriting.";
    case "checklist_not_seeded":
      return "Before we can track progress, we need to define what documents this deal requires based on deal type and amount.";
    case "underwrite_not_started":
      return "Underwriting analysis must be completed to assess risk factors and determine if the loan meets our credit standards.";
    case "committee_packet_missing":
      return "Credit committee requires a formatted packet with all relevant data, analysis, and recommendations for their review.";
    case "decision_missing":
      return "A formal credit decision must be recorded before we can proceed to closing or workout.";
    case "attestation_missing":
      return "Final sign-off confirms all conditions have been reviewed and the loan is ready for funding.";
    case "closing_docs_missing":
      return "Legal closing documents must be prepared and executed before funds can be disbursed.";
    default:
      return "This item must be resolved to move forward with the deal.";
  }
}

/**
 * Get a summary of what Buddy has automated for this deal.
 */
function getBuddyActionsSummary(state: LifecycleState): { completed: string[]; inProgress: string[] } {
  const completed: string[] = [];
  const inProgress: string[] = [];

  // Check what's been done based on derived state
  if (state.derived.documentsReadinessPct > 0) {
    const docPct = state.derived.documentsReadinessPct;
    if (state.derived.documentsReady) {
      completed.push("All required documents received and classified");
    } else {
      completed.push(`AI document readiness at ${Math.round(docPct)}%`);
      inProgress.push("Waiting for remaining documents from borrower");
    }
  }

  if (state.derived.financialSnapshotExists) {
    completed.push("Generated financial snapshot with key ratios");
  }

  if (state.derived.underwriteStarted) {
    completed.push("Initiated underwriting analysis");
  }

  if (state.derived.committeePacketReady) {
    completed.push("Compiled committee packet");
  }

  // Stage-based inferences
  if (state.stage !== "intake_created") {
    completed.push("Set up deal and created document checklist");
  }

  if (["docs_requested", "docs_in_progress"].includes(state.stage)) {
    completed.push("Sent document request to borrower portal");
    if (!state.derived.documentsReady) {
      inProgress.push("Monitoring for missing documents");
    }
  }

  return { completed, inProgress };
}

function getBlockerIcon(code: string): string {
  switch (code) {
    // Business logic blockers
    case "gatekeeper_docs_incomplete":
      return "docs_add_on";
    case "gatekeeper_docs_need_review":
      return "rate_review";
    case "financial_snapshot_missing":
      return "account_balance";
    case "checklist_not_seeded":
      return "checklist";
    case "underwrite_not_started":
      return "edit_note";
    case "committee_packet_missing":
      return "folder";
    case "decision_missing":
      return "gavel";
    case "attestation_missing":
      return "verified_user";
    case "closing_docs_missing":
      return "assignment";
    case "deal_not_found":
      return "search_off";
    // Specific fetch failure blockers
    case "checklist_fetch_failed":
      return "checklist";
    case "snapshot_fetch_failed":
      return "account_balance";
    case "decision_fetch_failed":
      return "gavel";
    case "attestation_fetch_failed":
      return "verified_user";
    case "packet_fetch_failed":
      return "folder";
    case "advancement_fetch_failed":
      return "arrow_forward";
    case "readiness_fetch_failed":
      return "fact_check";
    // Generic infrastructure blockers
    case "data_fetch_failed":
      return "cloud_off";
    case "internal_error":
      return "error";
    default:
      return "warning";
  }
}

/**
 * Format blocker evidence for display.
 */
function formatEvidence(blocker: LifecycleBlocker): string | null {
  if (!blocker.evidence || Object.keys(blocker.evidence).length === 0) {
    return null;
  }

  // Default: show first key-value pair
  const [key, value] = Object.entries(blocker.evidence)[0];
  if (typeof value === "string") {
    return `${key}: ${value}`;
  }
  return null;
}

/**
 * Fixable Blocker Card component.
 */
function FixableBlockerCard({
  blocker,
  dealId,
  onRefresh,
}: {
  blocker: LifecycleBlocker;
  dealId: string;
  onRefresh: () => void;
}) {
  const fixAction = getBlockerFixAction(blocker, dealId);
  const evidence = formatEvidence(blocker);

  return (
    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 overflow-hidden">
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-amber-400 text-[18px] mt-0.5">
            {getBlockerIcon(blocker.code)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-200 font-medium">{blocker.message}</p>
            {evidence && (
              <p className="text-xs text-amber-200/60 mt-0.5">{evidence}</p>
            )}
          </div>
        </div>
      </div>
      {fixAction && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border-t border-amber-500/10">
          {fixAction.href ? (
            <Link
              href={fixAction.href}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-200 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
              {fixAction.label}
            </Link>
          ) : (
            <button
              onClick={() => {
                console.log("Action:", fixAction.action);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-200 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">bolt</span>
              {fixAction.label}
            </button>
          )}
          {fixAction.secondary && (
            <button
              onClick={() => {
                // TODO: Implement secondary actions (like send reminder)
                console.log("Secondary action:", fixAction.secondary?.action);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/5 hover:bg-white/10 px-2.5 py-1 text-xs font-medium text-white/60 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">send</span>
              {fixAction.secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Explain like I'm a banker" panel.
 * Provides trust-building explanations for blockers and summarizes Buddy's work.
 */
function BankerExplainerPanel({
  state,
  isExpanded,
  onToggle,
}: {
  state: LifecycleState;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { completed, inProgress } = getBuddyActionsSummary(state);
  const hasBlockers = state.blockers.length > 0;

  return (
    <div className="border-t border-white/10 mt-4 pt-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-xs text-white/50 hover:text-white/70 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[14px]">help_outline</span>
          Explain like I'm a banker
        </span>
        <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
          expand_more
        </span>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* What Buddy already did */}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300/80 mb-2">
              <span className="material-symbols-outlined text-[12px]">smart_toy</span>
              What Buddy already did
            </div>
            {completed.length === 0 ? (
              <p className="text-xs text-white/40 italic">No automated actions yet</p>
            ) : (
              <ul className="space-y-1.5">
                {completed.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-white/60">
                    <span className="material-symbols-outlined text-emerald-400 text-[12px] mt-0.5">check_circle</span>
                    {item}
                  </li>
                ))}
              </ul>
            )}
            {inProgress.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {inProgress.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-white/50">
                    <span className="material-symbols-outlined text-sky-400 text-[12px] mt-0.5 animate-pulse">pending</span>
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Why Buddy is asking for blockers */}
          {hasBlockers && (
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300/80 mb-2">
                <span className="material-symbols-outlined text-[12px]">lightbulb</span>
                Why we need these items
              </div>
              <div className="space-y-3">
                {state.blockers.map((blocker, i) => (
                  <div key={`${blocker.code}-${i}`} className="rounded-lg bg-white/[0.02] border border-white/5 p-2.5">
                    <p className="text-xs text-white/70 font-medium mb-1">{blocker.message}</p>
                    <p className="text-[11px] text-white/40 leading-relaxed">
                      {getBankerExplanation(blocker)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick stat */}
          <div className="flex items-center gap-4 pt-2 border-t border-white/5">
            <div className="text-center">
              <div className="text-lg font-bold text-violet-300">{completed.length}</div>
              <div className="text-[10px] text-white/40">automated steps</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-amber-300">{state.blockers.length}</div>
              <div className="text-[10px] text-white/40">items pending</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-sky-300">{Math.round(state.derived.documentsReadinessPct)}%</div>
              <div className="text-[10px] text-white/40">docs received</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LifecycleStatusPanel({ dealId, initialState, available }: Props) {
  const router = useRouter();
  const [state, setState] = useState<LifecycleState | null>(initialState);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [advanceResult, setAdvanceResult] = useState<{
    type: "success" | "error" | "blocked";
    message: string;
  } | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [bankerExplainerOpen, setBankerExplainerOpen] = useState(false);

  // Determine if lifecycle is unavailable (either from prop or state inspection)
  const lifecycleUnavailable = available === false || fetchFailed || isLifecycleUnavailable(state);
  const correlationId = getCorrelationId(state);

  const refresh = useCallback(async () => {
    try {
      setFetchFailed(false);
      const res = await fetch(`/api/deals/${dealId}/lifecycle`);
      const data = await res.json();
      // Always returns 200 now, check ok field
      if (data.state) {
        setState(data.state);
        // If ok is false, mark as unavailable
        if (!data.ok) {
          setFetchFailed(true);
        }
      }
    } catch (e) {
      console.error("[LifecycleStatusPanel] Refresh failed:", e);
      setFetchFailed(true);
    }
  }, [dealId]);

  /**
   * Execute a server action (for one-click actions like "Generate Snapshot").
   */
  const executeServerAction = useCallback(async (action: ServerActionType): Promise<{ ok: boolean; error?: string }> => {
    try {
      let endpoint: string;
      let method = "POST";

      switch (action) {
        case "generate_snapshot":
          endpoint = `/api/deals/${dealId}/snapshot/generate`;
          break;
        case "generate_packet":
          endpoint = `/api/deals/${dealId}/committee/packet/generate`;
          break;
        case "run_ai_classification":
          endpoint = `/api/deals/${dealId}/files/classify-all`;
          break;
        case "send_reminder":
          endpoint = `/api/deals/${dealId}/borrower/reminder`;
          break;
        default:
          return { ok: false, error: "Unknown action" };
      }

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }

      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Network error" };
    }
  }, [dealId]);

  const handleNextAction = useCallback(async () => {
    if (!state) return;

    const nextAction = getNextAction(state, dealId);

    // If blocked or complete, don't do anything
    if (nextAction.intent === "blocked" || nextAction.intent === "complete") {
      return;
    }

    setIsAdvancing(true);
    setAdvanceResult(null);

    try {
      // For runnable actions, execute the server action first
      if (nextAction.intent === "runnable" && nextAction.serverAction) {
        const actionResult = await executeServerAction(nextAction.serverAction);

        if (!actionResult.ok) {
          setAdvanceResult({
            type: "error",
            message: actionResult.error || "Action failed",
          });
          setIsAdvancing(false);
          return;
        }

        // Action succeeded - show brief success then advance if needed
        setAdvanceResult({
          type: "success",
          message: `${nextAction.label} complete`,
        });
      }

      // If should advance, do it now
      if (nextAction.shouldAdvance) {
        const res = await fetch(`/api/deals/${dealId}/lifecycle/advance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();

        if (data.ok && data.advanced) {
          setState(data.state);
          setAdvanceResult({
            type: "success",
            message: `Advanced to ${STAGE_LABELS[data.state.stage as LifecycleStage] || data.state.stage}`,
          });
          // Navigate after short delay to show success (only if not a runnable action)
          if (nextAction.intent !== "runnable" && nextAction.href) {
            setTimeout(() => router.push(nextAction.href!), 500);
          }
        } else if (data.ok && !data.advanced) {
          // Refresh state to show new status
          await refresh();
        } else if (data.error === "blocked") {
          setState(data.state);
          setAdvanceResult({
            type: "blocked",
            message: `Blocked by ${data.blockers?.length || 0} issue(s)`,
          });
        } else {
          setAdvanceResult({
            type: "error",
            message: data.error || "Advance failed",
          });
        }
      } else if (nextAction.intent === "navigate" && nextAction.href) {
        // Just navigate (for non-runnable, non-advance actions)
        router.push(nextAction.href);
      } else if (nextAction.intent === "runnable") {
        // Runnable action completed without advance - refresh to show new state
        await refresh();
      }
    } catch (e) {
      console.error("[LifecycleStatusPanel] Action failed:", e);
      setAdvanceResult({
        type: "error",
        message: "Network error",
      });
    } finally {
      setIsAdvancing(false);
    }
  }, [dealId, state, router, executeServerAction, refresh]);

  if (!state) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Lifecycle</span>
        </div>
        <div className="p-4 text-center text-white/40 text-sm">
          Loading lifecycle state...
        </div>
      </div>
    );
  }

  const currentStageIndex = STAGE_ORDER.indexOf(state.stage);
  const progressPct = state.stage === "workout"
    ? 100
    : Math.round(((currentStageIndex + 1) / STAGE_ORDER.length) * 100);

  const nextAction = getNextAction(state, dealId);
  const nextActionIcon = getNextActionIcon(nextAction.intent);

  // Button styling based on intent
  const getButtonStyle = () => {
    switch (nextAction.intent) {
      case "advance":
        return "bg-gradient-to-r from-sky-500 to-emerald-500 text-white hover:from-sky-400 hover:to-emerald-400 shadow-lg shadow-sky-500/20";
      case "runnable":
        return "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-400 hover:to-fuchsia-400 shadow-lg shadow-violet-500/20";
      case "navigate":
        return "bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-400 hover:to-indigo-400 shadow-lg shadow-blue-500/20";
      case "blocked":
        return "bg-amber-500/20 text-amber-300 cursor-not-allowed";
      case "complete":
        return "bg-emerald-500/20 text-emerald-300 cursor-default";
      default:
        return "bg-white/5 text-white/30";
    }
  };

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Lifecycle</span>
          <button
            onClick={refresh}
            className="text-white/40 hover:text-white/70 transition-colors"
            title="Refresh"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Unavailable Warning Banner */}
        {lifecycleUnavailable && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-red-400 text-[16px] mt-0.5">cloud_off</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-red-200 font-medium">Lifecycle temporarily unavailable</p>
                <p className="text-[10px] text-red-200/60 mt-0.5">
                  Showing partial data. Some actions may be disabled.
                </p>
                {correlationId && (
                  <p className="text-[10px] text-red-200/40 mt-1 font-mono">
                    ID: {correlationId}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Current Stage Badge + Next Action */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={cn(
              "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold",
              lifecycleUnavailable ? "bg-white/10 text-white/50 border-white/20" : getStageColor(state.stage)
            )}>
              {lifecycleUnavailable ? "—" : (STAGE_LABELS[state.stage] || state.stage)}
            </span>
            <span className="text-xs text-white/40">{lifecycleUnavailable ? "—" : `${progressPct}%`}</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
          {lifecycleUnavailable ? (
            <div className="absolute inset-0 bg-white/5" />
          ) : (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          )}
        </div>

        {/* Derived Facts */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              lifecycleUnavailable ? "bg-white/20" : (state.derived.documentsReady ? "bg-emerald-400" : "bg-amber-400")
            )} />
            <span className="text-white/60">
              Docs: {lifecycleUnavailable ? "—" : `${Math.round(state.derived.documentsReadinessPct)}%`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              lifecycleUnavailable ? "bg-white/20" : (state.derived.financialSnapshotExists ? "bg-emerald-400" : "bg-amber-400")
            )} />
            <span className="text-white/60">
              Financial snapshot
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              lifecycleUnavailable ? "bg-white/20" : (state.derived.underwriteStarted ? "bg-emerald-400" : "bg-white/20")
            )} />
            <span className="text-white/60">
              Underwriting
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              lifecycleUnavailable ? "bg-white/20" : (state.derived.decisionPresent ? "bg-emerald-400" : "bg-white/20")
            )} />
            <span className="text-white/60">
              Decision
            </span>
          </div>
        </div>

        {/* Blockers Section - Now Fixable Cards */}
        {state.blockers.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">
              Fix to Continue ({state.blockers.length})
            </span>
            <div className="space-y-2">
              {state.blockers.map((blocker, i) => (
                <FixableBlockerCard
                  key={`${blocker.code}-${i}`}
                  blocker={blocker}
                  dealId={dealId}
                  onRefresh={refresh}
                />
              ))}
            </div>
          </div>
        )}

        {/* Next Best Action Button */}
        <div className="pt-2">
          {advanceResult && (
            <div className={cn(
              "mb-3 rounded-lg px-3 py-2 text-xs",
              advanceResult.type === "success" && "bg-emerald-500/10 border border-emerald-500/20 text-emerald-200",
              advanceResult.type === "error" && "bg-red-500/10 border border-red-500/20 text-red-200",
              advanceResult.type === "blocked" && "bg-amber-500/10 border border-amber-500/20 text-amber-200"
            )}>
              {advanceResult.message}
            </div>
          )}

          <button
            onClick={handleNextAction}
            disabled={lifecycleUnavailable || nextAction.intent === "blocked" || nextAction.intent === "complete" || isAdvancing}
            className={cn(
              "w-full rounded-lg px-4 py-3 text-sm font-semibold transition-all",
              lifecycleUnavailable ? "bg-white/5 text-white/30 cursor-not-allowed" : getButtonStyle()
            )}
          >
            {isAdvancing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin material-symbols-outlined text-[18px]">progress_activity</span>
                Working...
              </span>
            ) : lifecycleUnavailable ? (
              <span className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[18px]">block</span>
                Actions Unavailable
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[18px]">{nextActionIcon}</span>
                {nextAction.label}
              </span>
            )}
          </button>
          {nextAction.description && (
            <p className="mt-2 text-[11px] text-white/40 text-center">
              {nextAction.description}
            </p>
          )}
        </div>

        {/* Last Advanced */}
        {state.lastAdvancedAt && (
          <p className="text-[10px] text-white/30 text-center">
            Last advanced: {new Date(state.lastAdvancedAt).toLocaleString()}
          </p>
        )}

        {/* Explain like I'm a banker panel */}
        {!lifecycleUnavailable && (
          <BankerExplainerPanel
            state={state}
            isExpanded={bankerExplainerOpen}
            onToggle={() => setBankerExplainerOpen(!bankerExplainerOpen)}
          />
        )}
      </div>
    </div>
  );
}
