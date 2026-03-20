"use client";

import Link from "next/link";
import type { ServerFlags } from "@/lib/builder/builderTypes";

type Props = {
  dealId: string;
  serverFlags: ServerFlags;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function FinancialsWorkspace({ dealId, serverFlags }: Props) {
  return (
    <div className="space-y-4">
      <div className={glass}>
        <div className="text-sm font-semibold text-white mb-2">Financial Summary</div>
        {serverFlags.snapshotExists ? (
          <div className="text-xs text-emerald-400 mb-3">
            Financial snapshot is available. View full details in the Financials tab.
          </div>
        ) : (
          <div className="text-xs text-white/40 mb-3">
            No financial snapshot yet. Upload financial documents to generate one.
          </div>
        )}
        <div className="flex gap-2">
          <Link
            href={`/deals/${dealId}/financials`}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            Open Full Financials
          </Link>
          <Link
            href={`/deals/${dealId}/classic-spreads`}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            Open Spreads
          </Link>
        </div>
      </div>
    </div>
  );
}
