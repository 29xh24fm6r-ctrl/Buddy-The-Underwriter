"use client";

import Link from "next/link";
import type { BuilderState, ServerFlags } from "@/lib/builder/builderTypes";
import { computeStepCompletions } from "@/lib/builder/builderCompletion";
import { MilestoneChip } from "../MilestoneChip";

type Props = {
  state: BuilderState;
  serverFlags: ServerFlags;
  dealId: string;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function ReviewWorkspace({ state, serverFlags, dealId }: Props) {
  const steps = computeStepCompletions(state, serverFlags);
  const { readiness } = state;

  return (
    <div className="space-y-4">
      {/* Milestone Readiness */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={glass}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white">Credit Ready</div>
            <MilestoneChip label="Credit Ready" active={readiness.credit_ready} />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${readiness.credit_ready_pct}%` }} />
            </div>
            <span className="text-xs font-semibold text-white/70">{readiness.credit_ready_pct}%</span>
          </div>
          {readiness.credit_ready_blockers.length > 0 && (
            <ul className="space-y-1">
              {readiness.credit_ready_blockers.map((b) => (
                <li key={b.key} className="text-xs text-amber-200/80">&bull; {b.label}</li>
              ))}
            </ul>
          )}
        </div>

        <div className={glass}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white">Doc Ready</div>
            <MilestoneChip label="Doc Ready" active={readiness.doc_ready} />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${readiness.doc_ready_pct}%` }} />
            </div>
            <span className="text-xs font-semibold text-white/70">{readiness.doc_ready_pct}%</span>
          </div>
          {readiness.doc_ready_blockers.length > 0 && (
            <ul className="space-y-1">
              {readiness.doc_ready_blockers.map((b) => (
                <li key={b.key} className="text-xs text-white/50">&bull; {b.label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Section Completeness */}
      <div className={glass}>
        <div className="text-sm font-semibold text-white mb-3">Section Completeness</div>
        <div className="space-y-2">
          {steps.map((step) => (
            <div key={step.key} className="flex items-center justify-between">
              <span className="text-xs text-white/70">{step.label}</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${step.complete ? "bg-emerald-500" : "bg-white/30"}`}
                    style={{ width: `${step.pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-white/50 w-8 text-right">{step.pct}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/credit-memo/${dealId}/canonical`}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
        >
          Generate Credit Memo
        </Link>
        <button
          type="button"
          disabled={!readiness.credit_ready}
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Submit to Credit
        </button>
        {/* Generate Docs: hidden until document generation backend is ready */}
        <Link
          href={`/deals/${dealId}/portal-inbox`}
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
        >
          Request Missing Docs
        </Link>
      </div>
    </div>
  );
}
