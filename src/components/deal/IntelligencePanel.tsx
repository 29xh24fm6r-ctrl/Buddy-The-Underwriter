"use client";

/**
 * Phase 59 — Intelligence Panel
 *
 * Always visible at top of cockpit. Shows live pipeline progress,
 * completion summary, and retry controls. Creates the "Buddy is alive"
 * perception.
 */

import { useState } from "react";
import { useAutoIntelligence } from "@/lib/hooks/useAutoIntelligence";
import { IntelligenceStep } from "./IntelligenceStep";

const STEP_LABELS: Record<string, string> = {
  extract_facts: "Analyzing financial documents",
  generate_snapshot: "Building deal snapshot",
  lender_match: "Finding matching lenders",
  risk_recompute: "Evaluating risk profile",
};

export function IntelligencePanel({ dealId }: { dealId: string }) {
  const intel = useAutoIntelligence(dealId);
  const [collapsed, setCollapsed] = useState(false);

  // No run yet — show waiting state
  if (!intel.hasRun) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30 animate-pulse">●</span>
          <span className="text-xs text-white/40">Waiting for documents to begin analysis</span>
        </div>
      </div>
    );
  }

  // Running — primary alive state
  if (intel.isRunning) {
    return (
      <div className="rounded-xl border border-sky-500/20 bg-sky-950/20 px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-sky-400 animate-pulse">●</span>
            <span className="text-xs font-semibold text-sky-300">Buddy is analyzing this deal</span>
          </div>
          <span className="text-white/30 text-[12px]">{collapsed ? "▸" : "▾"}</span>
        </button>
        {!collapsed && (
          <div className="mt-2 pl-1">
            {intel.steps.map((step) => (
              <IntelligenceStep
                key={step.code}
                code={step.code}
                label={STEP_LABELS[step.code] ?? step.label}
                status={step.status}
                errorDetail={step.errorDetail}
              />
            ))}
            {intel.lastUpdatedAt && (
              <div className="text-[10px] text-white/20 mt-1.5">Last update: just now</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Completed successfully
  if (intel.isReady) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-400">✓</span>
            <span className="text-xs font-semibold text-emerald-300">Buddy has analyzed this deal</span>
            <span className="text-[10px] text-white/30 ml-2">
              {intel.succeededCount} complete
              {intel.steps.some((s) => s.status === "skipped") ? ` · ${intel.steps.filter((s) => s.status === "skipped").length} skipped` : ""}
            </span>
          </div>
          <span className="text-white/30 text-[12px]">{collapsed ? "▸" : "▾"}</span>
        </button>
        {!collapsed && (
          <div className="mt-2 pl-1">
            {intel.steps.map((step) => (
              <IntelligenceStep
                key={step.code}
                code={step.code}
                label={STEP_LABELS[step.code] ?? step.label}
                status={step.status}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Partial or failed
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-400">⚠</span>
          <span className="text-xs font-semibold text-amber-300">
            {intel.isFailed ? "Analysis needs attention" : "Buddy completed analysis with some issues"}
          </span>
        </div>
        <button
          type="button"
          onClick={intel.retry}
          disabled={intel.retrying}
          className="text-[10px] font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-50"
        >
          {intel.retrying ? "Retrying..." : "Retry"}
        </button>
      </div>
      <div className="mt-2 pl-1">
        {intel.steps.map((step) => (
          <IntelligenceStep
            key={step.code}
            code={step.code}
            label={STEP_LABELS[step.code] ?? step.label}
            status={step.status}
            errorDetail={step.errorDetail}
          />
        ))}
      </div>
    </div>
  );
}
