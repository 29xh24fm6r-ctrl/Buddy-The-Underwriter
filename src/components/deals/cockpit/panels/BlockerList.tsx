"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LifecycleBlocker } from "@/buddy/lifecycle/model";
import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";

const BLOCKER_ICONS: Record<string, string> = {
  missing_required_docs: "folder_off",
  checklist_not_seeded: "playlist_add",
  financial_snapshot_missing: "monitoring",
  committee_packet_missing: "description",
  decision_missing: "gavel",
  attestation_missing: "verified",
  closing_docs_missing: "folder_open",
  deal_not_found: "error",
  internal_error: "warning",
};

type Props = {
  blockers: LifecycleBlocker[];
  dealId: string;
  onServerAction?: (action: string) => void;
};

export function BlockerList({ blockers, dealId, onServerAction }: Props) {
  if (blockers.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">
        Blockers ({blockers.length})
      </div>
      {blockers.map((blocker, idx) => {
        const fix = getBlockerFixAction(blocker, dealId);
        const icon = BLOCKER_ICONS[blocker.code] || "block";
        const isFetchError = blocker.code.endsWith("_fetch_failed") || blocker.code === "internal_error" || blocker.code === "data_fetch_failed";

        return (
          <div
            key={`${blocker.code}-${idx}`}
            className={cn(
              "rounded-lg border px-3 py-2.5",
              isFetchError
                ? "border-white/10 bg-white/[0.02]"
                : "border-amber-500/20 bg-amber-500/5",
            )}
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  "material-symbols-outlined text-[16px] mt-0.5 shrink-0",
                  isFetchError ? "text-white/30" : "text-amber-400",
                )}
              >
                {icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className={cn("text-xs font-medium", isFetchError ? "text-white/50" : "text-white/80")}>
                  {blocker.message}
                </div>

                {/* Show missing doc keys if available */}
                {blocker.code === "missing_required_docs" && Array.isArray(blocker.evidence?.missing) ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(blocker.evidence!.missing as string[]).slice(0, 5).map((key: string) => (
                      <span
                        key={key}
                        className="inline-flex px-1.5 py-0.5 rounded bg-amber-500/10 text-[10px] text-amber-300/70 font-mono"
                      >
                        {key.replace(/_/g, " ")}
                      </span>
                    ))}
                    {(blocker.evidence!.missing as string[]).length > 5 && (
                      <span className="text-[10px] text-white/30">
                        +{(blocker.evidence!.missing as string[]).length - 5} more
                      </span>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Fix action button */}
              {fix && (
                <div className="flex items-center gap-1 shrink-0">
                  {fix.secondary && onServerAction && (
                    <button
                      onClick={() => onServerAction(fix.secondary!.action)}
                      className="px-2 py-1 rounded text-[10px] font-medium text-white/50 hover:text-white/70 border border-white/10 hover:border-white/20 transition-colors"
                    >
                      {fix.secondary.label}
                    </button>
                  )}
                  <Link
                    href={fix.href}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors",
                      isFetchError
                        ? "text-white/50 hover:text-white/70 border border-white/10 hover:border-white/20"
                        : "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border border-amber-500/30",
                    )}
                  >
                    {fix.label}
                  </Link>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
