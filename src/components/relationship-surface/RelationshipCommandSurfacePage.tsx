"use client";

import { useState, useCallback, useEffect } from "react";
import type {
  RelationshipSurfaceItem,
  RelationshipSurfaceTimelineEntry,
  CommandSurfaceListResponse,
} from "@/core/relationship-surface/types";
import RelationshipSurfaceFilters from "./RelationshipSurfaceFilters";
import RelationshipSurfaceTable from "./RelationshipSurfaceTable";
import RelationshipSurfaceFocusRail from "./RelationshipSurfaceFocusRail";
import RelationshipSurfaceTimelineDrawer from "./RelationshipSurfaceTimelineDrawer";

interface Props {
  initialData: CommandSurfaceListResponse | null;
}

export default function RelationshipCommandSurfacePage({ initialData }: Props) {
  const [data, setData] = useState<CommandSurfaceListResponse | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusItem, setFocusItem] = useState<RelationshipSurfaceItem | null>(null);
  const [timeline, setTimeline] = useState<RelationshipSurfaceTimelineEntry[]>([]);
  const [timelineOpen, setTimelineOpen] = useState(false);

  // Filters
  const [priorityBucket, setPriorityBucket] = useState<string | null>(null);
  const [reasonFamily, setReasonFamily] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(false);

  const fetchSurface = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (priorityBucket) params.set("priorityBucket", priorityBucket);
      if (reasonFamily) params.set("reasonFamily", reasonFamily);
      if (changedOnly) params.set("changedOnly", "1");

      const resp = await fetch(`/api/relationships/command-surface?${params}`);
      const json = await resp.json();
      if (json.items) setData(json);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [priorityBucket, reasonFamily, changedOnly]);

  useEffect(() => {
    fetchSurface();
  }, [fetchSurface]);

  const handleSelect = useCallback(
    async (relationshipId: string) => {
      setSelectedId(relationshipId);
      try {
        const resp = await fetch(
          `/api/relationships/${relationshipId}/command-surface`,
        );
        const json = await resp.json();
        if (json.item) {
          setFocusItem(json.item);
          setTimeline(json.timeline ?? []);
        }
      } catch {
        // silent
      }
    },
    [],
  );

  const handleAcknowledge = useCallback(
    async (relationshipId: string, reasonCode: string) => {
      try {
        await fetch("/api/relationships/command-surface/acknowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relationshipId, primaryReasonCode: reasonCode }),
        });
        fetchSurface();
      } catch {
        // silent
      }
    },
    [fetchSurface],
  );

  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-[#0b0d10] text-white">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">Relationship Command Surface</h1>
            <p className="text-sm text-white/50 mt-1">
              Unified operating surface across all relationship layers
            </p>
          </div>
          <button
            onClick={fetchSurface}
            disabled={loading}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-5 gap-3 mb-6">
            {[
              { label: "Total", value: summary.total, color: "text-white" },
              { label: "Critical", value: summary.critical, color: "text-red-400" },
              { label: "Urgent", value: summary.urgent, color: "text-amber-400" },
              { label: "Watch", value: summary.watch, color: "text-blue-400" },
              { label: "Healthy", value: summary.healthy, color: "text-emerald-400" },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center"
              >
                <div className={`text-2xl font-mono font-bold ${card.color}`}>
                  {card.value}
                </div>
                <div className="text-xs text-white/50 mt-1">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="mb-4">
          <RelationshipSurfaceFilters
            priorityBucket={priorityBucket}
            reasonFamily={reasonFamily}
            changedOnly={changedOnly}
            onPriorityBucketChange={setPriorityBucket}
            onReasonFamilyChange={setReasonFamily}
            onChangedOnlyChange={setChangedOnly}
          />
        </div>

        {/* Main layout: table + focus rail */}
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            <RelationshipSurfaceTable
              items={data?.items ?? []}
              onSelect={handleSelect}
              onAcknowledge={handleAcknowledge}
            />
          </div>

          {focusItem && (
            <div className="w-[380px] shrink-0">
              <div className="sticky top-20">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white/70">Focus</h2>
                  <button
                    onClick={() => setTimelineOpen(true)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    View Timeline
                  </button>
                </div>
                <RelationshipSurfaceFocusRail item={focusItem} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline drawer */}
      <RelationshipSurfaceTimelineDrawer
        timeline={timeline}
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
      />
    </div>
  );
}
