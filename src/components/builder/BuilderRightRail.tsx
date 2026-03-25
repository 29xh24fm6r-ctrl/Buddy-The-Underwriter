"use client";

import type { BuilderReadiness } from "@/lib/builder/builderTypes";
import { MissingItemsPanel } from "./MissingItemsPanel";
import { SaveStatePill } from "./SaveStatePill";

type Props = {
  readiness: BuilderReadiness;
  saveState: "idle" | "saving" | "saved" | "error";
  lastSaved: string | null;
};

export function BuilderRightRail({ readiness, saveState, lastSaved }: Props) {
  return (
    <div className="space-y-4">
      {/* Save state */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/50">Auto-save</span>
          <SaveStatePill state={saveState} />
        </div>
        {lastSaved && (
          <div className="text-[10px] text-white/40">
            Last saved: {new Date(lastSaved).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Credit Readiness */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-sm font-semibold text-white">Credit Readiness</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${readiness.credit_ready_pct}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-white/70">
            {readiness.credit_ready_pct}%
          </span>
        </div>
        {readiness.credit_ready_blockers.length > 0 && (
          <MissingItemsPanel items={readiness.credit_ready_blockers} />
        )}
      </div>

      {/* Doc Readiness */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-sm font-semibold text-white">Doc Readiness</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${readiness.doc_ready_pct}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-white/70">
            {readiness.doc_ready_pct}%
          </span>
        </div>
        {readiness.doc_ready_blockers.length > 0 && (
          <ul className="space-y-1">
            {readiness.doc_ready_blockers.map((b) => (
              <li key={b.key} className="text-[11px] text-white/50">
                &bull; {b.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
