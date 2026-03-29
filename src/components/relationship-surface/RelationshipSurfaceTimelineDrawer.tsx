"use client";

import type { RelationshipSurfaceTimelineEntry } from "@/core/relationship-surface/types";

interface Props {
  timeline: RelationshipSurfaceTimelineEntry[];
  open: boolean;
  onClose: () => void;
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-400",
  warning: "bg-amber-400",
  normal: "bg-white/30",
};

const LAYER_BADGE: Record<string, string> = {
  relationship: "text-blue-300",
  treasury: "text-emerald-300",
  expansion: "text-purple-300",
  protection: "text-amber-300",
  crypto: "text-orange-300",
};

export default function RelationshipSurfaceTimelineDrawer({
  timeline,
  open,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[400px] border-l border-white/10 bg-[#0b0d10] overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/50 backdrop-blur-xl px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Unified Timeline</h3>
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            close
          </span>
        </button>
      </div>

      <div className="p-4 space-y-1">
        {timeline.length === 0 && (
          <p className="text-sm text-white/40 text-center py-8">
            No timeline events yet.
          </p>
        )}

        {timeline.map((entry, i) => (
          <div
            key={i}
            className="flex gap-3 py-2 border-b border-white/5 last:border-0"
          >
            <div className="flex flex-col items-center pt-1.5">
              <span
                className={`h-2 w-2 rounded-full ${SEVERITY_DOT[entry.severity] ?? SEVERITY_DOT.normal}`}
              />
              {i < timeline.length - 1 && (
                <div className="w-px flex-1 bg-white/10 mt-1" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">
                  {entry.title}
                </span>
                <span
                  className={`text-[10px] ${LAYER_BADGE[entry.sourceLayer] ?? "text-white/40"}`}
                >
                  {entry.sourceLayer}
                </span>
              </div>
              {entry.summary && (
                <p className="text-xs text-white/50 mt-0.5">{entry.summary}</p>
              )}
              <p className="text-[10px] text-white/30 mt-0.5">
                {new Date(entry.eventAt).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
