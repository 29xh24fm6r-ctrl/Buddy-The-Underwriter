"use client";

import Link from "next/link";
import type { ServerFlags } from "@/lib/builder/builderTypes";

type Props = {
  dealId: string;
  serverFlags: ServerFlags;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function DocumentsWorkspace({ dealId, serverFlags }: Props) {
  return (
    <div className="space-y-4">
      <div className={glass}>
        <div className="text-sm font-semibold text-white mb-2">Documents</div>
        {serverFlags.documentsReady ? (
          <div className="text-xs text-emerald-400 mb-3">
            All required documents received.
          </div>
        ) : (
          <div className="text-xs text-amber-400 mb-3">
            Some documents are still needed.
          </div>
        )}
        <div className="flex gap-2">
          <Link
            href={`/deals/${dealId}/documents`}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            Open Documents
          </Link>
          <Link
            href={`/deals/${dealId}/portal-inbox`}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            Request from Borrower
          </Link>
        </div>
      </div>
    </div>
  );
}
