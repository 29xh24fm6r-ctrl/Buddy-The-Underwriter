"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { STAGE_LABELS, type LifecycleStage } from "@/buddy/lifecycle/model";
import { PrimaryCTAButton } from "./PrimaryCTAButton";
import { BlockerList } from "./BlockerList";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

const STAGE_ORDER: LifecycleStage[] = [
  "intake_created", "docs_requested", "docs_in_progress", "docs_satisfied",
  "underwrite_ready", "underwrite_in_progress", "committee_ready",
  "committee_decisioned", "closing_in_progress", "closed",
];

/** Convert checklist key to human-readable label */
function formatMissingDocKey(key: string): string {
  // Individual year tax returns: IRS_PERSONAL_2024 → "2024 Personal"
  const personalYearMatch = key.match(/^IRS_PERSONAL_(\d{4})$/);
  if (personalYearMatch) return `${personalYearMatch[1]} Personal`;

  const businessYearMatch = key.match(/^IRS_BUSINESS_(\d{4})$/);
  if (businessYearMatch) return `${businessYearMatch[1]} Business`;

  // Legacy grouped keys
  if (key === "IRS_PERSONAL_3Y") return "Personal 3Y";
  if (key === "IRS_BUSINESS_3Y") return "Business 3Y";
  if (key === "PFS_CURRENT") return "PFS";

  // Abbreviate common keys
  if (key === "FIN_STMT_PL_YTD") return "P&L YTD";
  if (key === "FIN_STMT_BS_YTD") return "Balance Sheet";

  // Default: abbreviate
  return key.replace(/_/g, " ").slice(0, 15);
}

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

type Props = {
  dealId: string;
  isAdmin?: boolean;
  onServerAction?: (action: string) => void;
  onAdvance?: () => void;
};

export function ReadinessPanel({ dealId, isAdmin, onServerAction, onAdvance }: Props) {
  const { lifecycleState, isInitialLoading, error } = useCockpitDataContext();
  const [bankerExplainerOpen, setBankerExplainerOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
          onAdvance?.();
          return;
        }

        if (action === "financial_snapshot.recompute") {
          let res = await fetch(`/api/deals/${dealId}/financial-snapshot/recompute`, {
            method: "POST",
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);

            // Auto-heal: if NO_FACTS, materialize anchor facts from classified docs and retry once
            if (res.status === 422 && body?.reason === "NO_FACTS") {
              const matRes = await fetch(
                `/api/deals/${dealId}/financial-facts/materialize-from-docs`,
                { method: "POST" },
              ).catch(() => null);
              const matBody = await matRes?.json().catch(() => null);

              if (matBody?.ok && matBody.factsWritten > 0) {
                // Retry recompute now that anchor facts exist
                res = await fetch(`/api/deals/${dealId}/financial-snapshot/recompute`, {
                  method: "POST",
                });
                if (res.ok) {
                  onAdvance?.();
                  return;
                }
              }

              // Still blocked after auto-heal attempt
              setActionError(
                "No financial data extracted yet. Upload and classify financial documents, then try again.",
              );
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

  const derived = lifecycleState?.derived;
  const blockers = lifecycleState?.blockers ?? [];
  const stage = lifecycleState?.stage;

  // Compute overall progress from stage position
  const stageIdx = stage ? STAGE_ORDER.indexOf(stage) : 0;
  const stagePct = Math.round(((stageIdx + 1) / STAGE_ORDER.length) * 100);

  // Docs readiness
  const docsPct = derived?.requiredDocsReceivedPct ?? 0;

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
              {blockers.length > 0 ? "warning" : "verified"}
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

        {/* Readiness progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-white/50">
            <span>Documents</span>
            <span>{Math.round(docsPct)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                docsPct === 100
                  ? "bg-emerald-400"
                  : "bg-sky-400",
              )}
              style={{ width: `${docsPct}%` }}
            />
          </div>
        </div>

        {/* Derived facts grid */}
        {derived && (
          <div className="grid grid-cols-2 gap-2">
            <DerivedFactDot label="Documents" ok={derived.borrowerChecklistSatisfied} />
            <DerivedFactDot label="AI Pipeline" ok={derived.aiPipelineComplete} />
            <DerivedFactDot label="Spreads" ok={derived.spreadsComplete} />
            <DerivedFactDot label="Financials" ok={derived.financialSnapshotExists} />
            <DerivedFactDot label="Pricing" ok={derived.pricingQuoteReady} />
            <DerivedFactDot label="Underwriting" ok={derived.underwriteStarted} />
            <DerivedFactDot label="Decision" ok={derived.decisionPresent} />
          </div>
        )}

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

        {/* Blockers */}
        <BlockerList
          blockers={blockers}
          dealId={dealId}
          onServerAction={handleServerAction}
          busyAction={busyAction}
        />
        {actionError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
            {actionError}
          </div>
        )}

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
                      <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", derived.borrowerChecklistSatisfied ? "bg-emerald-400" : "bg-amber-400/50")} />
                      <div>
                        {derived.borrowerChecklistSatisfied
                          ? "All required documents received and matched"
                          : `${Math.round(docsPct)}% of required documents received (${derived.requiredDocsMissing.length} missing)`}
                        {!derived.borrowerChecklistSatisfied && derived.requiredDocsMissing.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {derived.requiredDocsMissing.slice(0, 4).map((key: string) => (
                              <span
                                key={key}
                                className="inline-flex px-1.5 py-0.5 rounded bg-amber-500/10 text-[9px] text-amber-300/70"
                              >
                                {formatMissingDocKey(key)}
                              </span>
                            ))}
                            {derived.requiredDocsMissing.length > 4 && (
                              <span className="text-[9px] text-white/30">
                                +{derived.requiredDocsMissing.length - 4} more
                              </span>
                            )}
                          </div>
                        )}
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

                {blockers.length > 0 && (
                  <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3 space-y-2">
                    <div className="font-semibold text-white/70">Why it matters</div>
                    <p>
                      Buddy needs{" "}
                      {blockers.map((b) => b.message.toLowerCase()).join(", ")}.
                      Once resolved, the deal advances automatically.
                    </p>
                  </div>
                )}

                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                  <div className="font-semibold text-white/70 mb-1">Progress</div>
                  <div className="flex items-center gap-4 text-[10px] font-mono">
                    <span>Stage: {stageIdx + 1}/{STAGE_ORDER.length}</span>
                    <span>Docs: {Math.round(docsPct)}%</span>
                    <span>Blockers: {blockers.length}</span>
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
