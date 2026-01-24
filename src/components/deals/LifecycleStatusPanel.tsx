"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
// Import from client-safe module to avoid server-only code in client components
import type { LifecycleState, LifecycleStage, LifecycleBlocker } from "@/buddy/lifecycle/client";
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
};

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

function getBlockerIcon(code: string): string {
  switch (code) {
    // Business logic blockers
    case "missing_required_docs":
      return "description";
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

  // Special handling for missing docs
  if (blocker.code === "missing_required_docs" && blocker.evidence.missing) {
    const missing = blocker.evidence.missing as string[];
    if (missing.length <= 3) {
      return `Missing: ${missing.join(", ")}`;
    }
    return `Missing: ${missing.slice(0, 2).join(", ")} +${missing.length - 2} more`;
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
          <Link
            href={fixAction.href}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-200 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            {fixAction.label}
          </Link>
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

export function LifecycleStatusPanel({ dealId, initialState }: Props) {
  const router = useRouter();
  const [state, setState] = useState<LifecycleState | null>(initialState);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [advanceResult, setAdvanceResult] = useState<{
    type: "success" | "error" | "blocked";
    message: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/lifecycle`);
      const data = await res.json();
      if (data.ok && data.state) {
        setState(data.state);
      }
    } catch (e) {
      console.error("[LifecycleStatusPanel] Refresh failed:", e);
    }
  }, [dealId]);

  const handleNextAction = useCallback(async () => {
    if (!state) return;

    const nextAction = getNextAction(state, dealId);

    // If blocked or complete, don't do anything
    if (nextAction.intent === "blocked" || nextAction.intent === "complete") {
      return;
    }

    // If should advance first, then navigate
    if (nextAction.shouldAdvance) {
      setIsAdvancing(true);
      setAdvanceResult(null);

      try {
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
          // Navigate after short delay to show success
          if (nextAction.href) {
            setTimeout(() => router.push(nextAction.href!), 500);
          }
        } else if (data.ok && !data.advanced) {
          // No advancement needed, just navigate
          if (nextAction.href) {
            router.push(nextAction.href);
          }
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
      } catch (e) {
        console.error("[LifecycleStatusPanel] Advance failed:", e);
        setAdvanceResult({
          type: "error",
          message: "Network error",
        });
      } finally {
        setIsAdvancing(false);
      }
    } else if (nextAction.href) {
      // Just navigate
      router.push(nextAction.href);
    }
  }, [dealId, state, router]);

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
        {/* Current Stage Badge + Next Action */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={cn(
              "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold",
              getStageColor(state.stage)
            )}>
              {STAGE_LABELS[state.stage] || state.stage}
            </span>
            <span className="text-xs text-white/40">{progressPct}%</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Derived Facts */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              state.derived.borrowerChecklistSatisfied ? "bg-emerald-400" : "bg-amber-400"
            )} />
            <span className="text-white/60">
              Docs: {state.derived.requiredDocsReceivedPct}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              state.derived.financialSnapshotExists ? "bg-emerald-400" : "bg-amber-400"
            )} />
            <span className="text-white/60">
              Financial snapshot
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              state.derived.underwriteStarted ? "bg-emerald-400" : "bg-white/20"
            )} />
            <span className="text-white/60">
              Underwriting
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              state.derived.decisionPresent ? "bg-emerald-400" : "bg-white/20"
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
            disabled={nextAction.intent === "blocked" || nextAction.intent === "complete" || isAdvancing}
            className={cn(
              "w-full rounded-lg px-4 py-3 text-sm font-semibold transition-all",
              getButtonStyle()
            )}
          >
            {isAdvancing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin material-symbols-outlined text-[18px]">progress_activity</span>
                Working...
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
      </div>
    </div>
  );
}
