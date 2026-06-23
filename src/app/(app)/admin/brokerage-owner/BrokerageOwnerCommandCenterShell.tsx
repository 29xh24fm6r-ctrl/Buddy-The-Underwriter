"use client";

/**
 * Client shell for the Brokerage Owner Command Center page.
 *
 * Renders the owner command center with real data, or an honest empty
 * state when operational data is unavailable.
 *
 * Spec: 16B / Spec 18 — Owner/Admin Command Center Route Integration
 */

import type { BrokerageOwnerCommandCenterViewModel } from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";
import { BrokerageOwnerCommandCenter } from "@/components/admin/BrokerageOwnerCommandCenter";

export function BrokerageOwnerCommandCenterShell({
  viewModel,
  dealCount,
  evaluatedAt,
}: {
  viewModel: BrokerageOwnerCommandCenterViewModel | null;
  dealCount: number;
  evaluatedAt: string | null;
}) {
  // Honest empty state when no operational data is available
  if (!viewModel || dealCount === 0) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Brokerage owner command center
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-white">
          No operational data yet
        </h1>
        <p className="mt-2 max-w-md text-sm text-white/50">
          Brokerage operating data will appear here as deals move through
          Buddy SBA.
        </p>
        <p className="mt-4 text-[11px] uppercase tracking-wider text-white/30">
          Operational visibility only
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <BrokerageOwnerCommandCenter viewModel={viewModel} />

      {/* Evaluated-at footer for operational awareness */}
      {evaluatedAt && (
        <footer className="mt-6 text-center text-[11px] text-white/30">
          State evaluated at{" "}
          {new Date(evaluatedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </footer>
      )}
    </div>
  );
}
