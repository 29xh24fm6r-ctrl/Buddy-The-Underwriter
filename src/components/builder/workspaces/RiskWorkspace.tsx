"use client";

import Link from "next/link";
import type { ServerFlags } from "@/lib/builder/builderTypes";

type Props = {
  dealId: string;
  serverFlags: ServerFlags;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function RiskWorkspace({ dealId, serverFlags }: Props) {
  return (
    <div className="space-y-4">
      <div className={glass}>
        <div className="text-sm font-semibold text-white mb-2">Risk Analysis</div>
        {serverFlags.riskRunExists ? (
          <div className="text-xs text-emerald-400 mb-3">
            Risk analysis is available. View full details in the Risk tab.
          </div>
        ) : (
          <div className="text-xs text-white/40 mb-3">
            No risk analysis yet. Run analysis from the Risk tab to generate one.
          </div>
        )}
        <Link
          href={`/deals/${dealId}/risk`}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Open Full Risk Analysis
        </Link>
      </div>
    </div>
  );
}
