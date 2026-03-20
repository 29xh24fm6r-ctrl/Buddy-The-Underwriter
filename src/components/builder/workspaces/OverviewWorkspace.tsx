"use client";

import Link from "next/link";
import type { BuilderState, BuilderStepKey, DealSectionData, PartiesSectionData, StorySectionData, ServerFlags } from "@/lib/builder/builderTypes";

type Props = {
  state: BuilderState;
  serverFlags: ServerFlags;
  dealId: string;
  dealName: string;
  onStepNavigate: (step: BuilderStepKey) => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function OverviewWorkspace({ state, serverFlags, dealId, dealName, onStepNavigate }: Props) {
  const deal = state.sections.deal as Partial<DealSectionData> | undefined;
  const parties = state.sections.parties as Partial<PartiesSectionData> | undefined;
  const story = state.sections.story as Partial<StorySectionData> | undefined;
  const ownerCount = (parties?.owners ?? []).length;

  return (
    <div className="space-y-4">
      {/* Deal Snapshot */}
      <div className={glass}>
        <div className="text-sm font-semibold text-white mb-3">Deal Snapshot</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-white/50">Deal Name</span>
            <div className="text-white font-medium">{dealName || "\u2014"}</div>
          </div>
          <div>
            <span className="text-white/50">Loan Type</span>
            <div className="text-white font-medium capitalize">{deal?.loan_type?.replace(/_/g, " ") ?? "\u2014"}</div>
          </div>
          <div>
            <span className="text-white/50">Requested Amount</span>
            <div className="text-white font-medium">
              {deal?.requested_amount ? `$${deal.requested_amount.toLocaleString()}` : "\u2014"}
            </div>
          </div>
          <div>
            <span className="text-white/50">Parties</span>
            <div className="text-white font-medium">{ownerCount} owner{ownerCount !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      {/* Financial Snapshot (read-only) */}
      <div className={glass}>
        <div className="text-sm font-semibold text-white mb-2">Financial Snapshot</div>
        {serverFlags.snapshotExists ? (
          <div className="text-xs text-emerald-400">Snapshot available</div>
        ) : (
          <div className="text-xs text-white/40">No financial snapshot yet</div>
        )}
        <Link
          href={`/deals/${dealId}/financials`}
          className="mt-2 inline-block text-xs text-primary hover:underline"
        >
          Open Full Financials &rarr;
        </Link>
      </div>

      {/* Missing for Credit Ready */}
      {state.readiness.credit_ready_blockers.length > 0 && (
        <div className={glass}>
          <div className="text-sm font-semibold text-amber-300 mb-2">Missing for Credit Ready</div>
          <ul className="space-y-1">
            {state.readiness.credit_ready_blockers.map((b, i) => (
              <li key={i} className="text-xs text-amber-200/80">&bull; {b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onStepNavigate("parties")} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10">
          Add Owner
        </button>
        <button type="button" onClick={() => onStepNavigate("loan_request")} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10">
          Define Loan Request
        </button>
        <button type="button" onClick={() => onStepNavigate("story")} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10">
          Complete Story
        </button>
      </div>
    </div>
  );
}
