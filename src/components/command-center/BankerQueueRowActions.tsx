"use client";

/**
 * Phase 65H — Queue Row Actions
 *
 * Renders contextual action buttons per queue row.
 * Buttons are derived from server state — no client-side business logic.
 */

import Link from "next/link";
import type { BankerQueueItem } from "@/core/command-center/types";

type Props = {
  item: BankerQueueItem;
  onExecute: (dealId: string, actionCode: string) => void;
  onAcknowledge: (dealId: string, reasonCode: string) => void;
  onViewActivity: (dealId: string) => void;
  executing: boolean;
};

export default function BankerQueueRowActions({
  item,
  onExecute,
  onAcknowledge,
  onViewActivity,
  executing,
}: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {/* Execute — when 65E action exists */}
      {item.actionability === "execute_now" && item.primaryActionCode && (
        <button
          onClick={() => onExecute(item.dealId, item.primaryActionCode!)}
          disabled={executing}
          className="px-2 py-1 text-xs rounded bg-blue-600/80 text-white hover:bg-blue-500 transition disabled:opacity-50"
        >
          Execute
        </button>
      )}

      {/* Open — navigate to correct panel */}
      {item.href && (
        <Link
          href={item.href}
          className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition"
        >
          Open
        </Link>
      )}

      {/* Resend — when borrower campaign is active */}
      {item.actionability === "waiting_on_borrower" &&
        item.borrowerOverdueCount > 0 && (
          <Link
            href={`/deals/${item.dealId}/borrower`}
            className="px-2 py-1 text-xs rounded bg-amber-600/30 border border-amber-500/30 text-amber-300 hover:bg-amber-600/50 transition"
          >
            Resend
          </Link>
        )}

      {/* Acknowledge */}
      <button
        onClick={() => onAcknowledge(item.dealId, item.queueReasonCode)}
        className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-white/40 hover:text-white/70 hover:bg-white/10 transition"
        title="Acknowledge"
      >
        <span className="material-symbols-outlined text-[14px]">check</span>
      </button>

      {/* View Activity */}
      <button
        onClick={() => onViewActivity(item.dealId)}
        className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-white/40 hover:text-white/70 hover:bg-white/10 transition"
        title="View activity"
      >
        <span className="material-symbols-outlined text-[14px]">history</span>
      </button>
    </div>
  );
}
