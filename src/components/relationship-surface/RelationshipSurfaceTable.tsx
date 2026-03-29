"use client";

import type { RelationshipSurfaceItem } from "@/core/relationship-surface/types";

interface Props {
  items: RelationshipSurfaceItem[];
  onSelect: (relationshipId: string) => void;
  onAcknowledge: (relationshipId: string, reasonCode: string) => void;
}

const BUCKET_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/30",
  urgent: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  watch: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  healthy: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

export default function RelationshipSurfaceTable({
  items,
  onSelect,
  onAcknowledge,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/40">
        No relationships match the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          key={item.relationshipId}
          onClick={() => onSelect(item.relationshipId)}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left hover:bg-white/[0.05] transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-semibold border ${BUCKET_COLORS[item.priorityBucket] ?? ""}`}
                >
                  {item.priorityBucket.toUpperCase()}
                </span>
                {item.changedSinceViewed && (
                  <span className="h-2 w-2 rounded-full bg-blue-400" />
                )}
                <span className="text-sm font-semibold text-white truncate">
                  {item.relationshipId.slice(0, 8)}
                </span>
              </div>

              <div className="mt-1 text-sm text-white/80">
                {item.primaryReasonLabel}
              </div>
              {item.explanationLines[0] && (
                <div className="mt-0.5 text-xs text-white/50 line-clamp-1">
                  {item.explanationLines[0]}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              {item.primaryActionLabel && (
                <span className="text-xs text-blue-400">
                  {item.primaryActionLabel}
                </span>
              )}
              <span className="text-xs text-white/40">
                {item.blockingParty !== "none" ? `Blocked: ${item.blockingParty}` : item.health}
              </span>
              {item.changedSinceViewed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAcknowledge(item.relationshipId, item.primaryReasonCode);
                  }}
                  className="text-[10px] text-white/40 hover:text-white/70 underline"
                >
                  Acknowledge
                </button>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
