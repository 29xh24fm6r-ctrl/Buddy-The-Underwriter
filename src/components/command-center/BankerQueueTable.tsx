"use client";

/**
 * Phase 65H — Banker Queue Table
 *
 * Primary queue table: one row per deal, deterministic reason.
 * Columns: Urgency, Deal/Borrower, Stage, Why, Blocking, Primary Action, Age, Activity, Actions
 */

import Link from "next/link";
import type { BankerQueueItem } from "@/core/command-center/types";
import BankerQueueRowActions from "./BankerQueueRowActions";

type Props = {
  items: BankerQueueItem[];
  onExecute: (dealId: string, actionCode: string) => void;
  onAcknowledge: (dealId: string, reasonCode: string) => void;
  onViewActivity: (dealId: string) => void;
  executingDealId: string | null;
};

const URGENCY_STYLES: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  urgent: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  watch: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  healthy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

const BLOCKING_LABELS: Record<string, { label: string; className: string }> = {
  banker: { label: "Bank", className: "text-red-400" },
  borrower: { label: "Borrower", className: "text-amber-400" },
  buddy: { label: "Buddy", className: "text-blue-400" },
  mixed: { label: "Mixed", className: "text-purple-400" },
  unknown: { label: "—", className: "text-white/30" },
};

function formatAge(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatStage(stage: string): string {
  return stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function BankerQueueTable({
  items,
  onExecute,
  onAcknowledge,
  onViewActivity,
  executingDealId,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="glass-card rounded-xl p-8 text-center text-white/40">
        No deals match the current filters.
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <table className="w-full">
        <thead className="glass-header">
          <tr>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-white/70 uppercase w-20">
              Urgency
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-white/70 uppercase">
              Deal
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-white/70 uppercase">
              Stage
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-white/70 uppercase">
              Why
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-white/70 uppercase w-20">
              Blocking
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-white/70 uppercase">
              Primary Action
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-white/70 uppercase w-16">
              Age
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-white/70 uppercase w-20">
              Activity
            </th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold text-white/70 uppercase">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {items.map((item) => (
            <tr key={item.dealId} className="glass-row hover:bg-white/[0.02]">
              {/* Urgency */}
              <td className="px-4 py-3">
                <span
                  className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border ${
                    URGENCY_STYLES[item.urgencyBucket] ?? ""
                  }`}
                >
                  {item.urgencyBucket}
                </span>
              </td>

              {/* Deal / Borrower */}
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <Link
                    href={`/deals/${item.dealId}`}
                    className="text-sm font-medium text-white/90 hover:text-white transition"
                  >
                    {item.dealName}
                    {item.changedSinceViewed && (
                      <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-blue-400" />
                    )}
                  </Link>
                  {item.borrowerName && (
                    <span className="text-xs text-white/40">
                      {item.borrowerName}
                    </span>
                  )}
                </div>
              </td>

              {/* Stage */}
              <td className="px-4 py-3 text-xs text-white/60">
                {formatStage(item.canonicalStage)}
              </td>

              {/* Why it is here */}
              <td className="px-4 py-3">
                <span
                  className="text-xs text-white/70"
                  title={item.queueReasonDescription}
                >
                  {item.queueReasonLabel}
                </span>
              </td>

              {/* Blocking party */}
              <td className="px-4 py-3">
                <span
                  className={`text-xs font-medium ${
                    BLOCKING_LABELS[item.blockingParty]?.className ?? "text-white/30"
                  }`}
                >
                  {BLOCKING_LABELS[item.blockingParty]?.label ?? "—"}
                </span>
              </td>

              {/* Primary action */}
              <td className="px-4 py-3">
                {item.primaryActionLabel ? (
                  <span className="text-xs text-white/60">
                    {item.primaryActionLabel}
                  </span>
                ) : (
                  <span className="text-xs text-white/20">—</span>
                )}
              </td>

              {/* Age */}
              <td className="px-4 py-3 text-xs text-white/50">
                {formatAge(item.primaryActionAgeHours)}
              </td>

              {/* Activity */}
              <td className="px-4 py-3 text-xs text-white/40">
                {formatRelativeTime(item.latestActivityAt)}
              </td>

              {/* Actions */}
              <td className="px-4 py-3 text-right">
                <BankerQueueRowActions
                  item={item}
                  onExecute={onExecute}
                  onAcknowledge={onAcknowledge}
                  onViewActivity={onViewActivity}
                  executing={executingDealId === item.dealId}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
