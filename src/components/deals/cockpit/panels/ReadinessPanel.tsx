"use client";

import { useState, useCallback } from "react";
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
  const { lifecycleState } = useCockpitDataContext();
  const [bankerExplainerOpen, setBankerExplainerOpen] = useState(false);

  const handleServerAction = useCallback(
    async (action: string) => {
      if (onServerAction) {
        onServerAction(action);
        return;
      }
      // Default: call the lifecycle server action endpoint
      try {
        await fetch(`/api/deals/${dealId}/lifecycle/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
      } catch {
        // Toast will show via cockpit polling
      }
    },
    [dealId, onServerAction],
  );

  const derived = lifecycleState?.derived;
  const blockers = lifecycleState?.blockers ?? [];
  const stage = lifecycleState?.stage;

  // Compute overall progress from stage position
  const stageIdx = stage ? STAGE_ORDER.indexOf(stage) : 0;
  const stagePct = Math.round(((stageIdx + 1) / STAGE_ORDER.length) * 100);

  // Docs readiness
  const docsPct = derived?.requiredDocsReceivedPct ?? 0;

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
            <DerivedFactDot label="Financials" ok={derived.financialSnapshotExists} />
            <DerivedFactDot label="Underwriting" ok={derived.underwriteStarted} />
            <DerivedFactDot label="Decision" ok={derived.decisionPresent} />
          </div>
        )}

        {/* Blockers */}
        <BlockerList
          blockers={blockers}
          dealId={dealId}
          onServerAction={handleServerAction}
        />

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
                    <li className="flex items-center gap-2">
                      <span className={cn("w-1.5 h-1.5 rounded-full", derived.borrowerChecklistSatisfied ? "bg-emerald-400" : "bg-amber-400/50")} />
                      {derived.borrowerChecklistSatisfied
                        ? "All required documents received and matched"
                        : `${Math.round(docsPct)}% of required documents received (${derived.requiredDocsMissing.length} missing)`}
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
