"use client";

/**
 * Phase 65H — Activity Drawer
 *
 * Slide-out panel per deal showing actor-filtered timeline,
 * escalations, borrower campaign status, and latest changes.
 */

import { useEffect, useState } from "react";

type TimelineEvent = {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
  created_at: string;
  status?: string;
};

type Props = {
  dealId: string | null;
  dealName: string;
  onClose: () => void;
};

function getActorType(event: TimelineEvent): "buddy" | "borrower" | "banker" {
  const meta = event.meta ?? {};
  if (meta.actor_type === "borrower" || meta.source === "borrower_upload" || meta.source === "portal") {
    return "borrower";
  }
  if (meta.actor_type === "banker" || meta.source === "banker_invite") {
    return "banker";
  }
  return "buddy";
}

const ACTOR_COLORS: Record<string, string> = {
  buddy: "bg-blue-500/20 text-blue-400",
  borrower: "bg-emerald-500/20 text-emerald-400",
  banker: "bg-purple-500/20 text-purple-400",
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function CommandCenterActivityDrawer({
  dealId,
  dealName,
  onClose,
}: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [actorFilter, setActorFilter] = useState<string>("all");

  useEffect(() => {
    if (!dealId) return;
    setLoading(true);
    fetch(`/api/deals/${dealId}/timeline?limit=30`)
      .then((r) => r.json())
      .then((data) => setEvents(data.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [dealId]);

  if (!dealId) return null;

  const filtered =
    actorFilter === "all"
      ? events
      : events.filter((e) => getActorType(e) === actorFilter);

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] bg-[#0f1115] border-l border-white/10 z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-white/90">Activity</h3>
          <p className="text-xs text-white/40">{dealName}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/10 transition text-white/40 hover:text-white/70"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Actor filter */}
      <div className="flex gap-1 px-4 py-2 border-b border-white/5">
        {["all", "buddy", "borrower", "banker"].map((f) => (
          <button
            key={f}
            onClick={() => setActorFilter(f)}
            className={`px-2 py-0.5 text-[11px] rounded-full border transition ${
              actorFilter === f
                ? "bg-white/10 border-white/20 text-white/80"
                : "border-transparent text-white/40 hover:text-white/60"
            }`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && (
          <p className="text-xs text-white/30 text-center py-8">Loading...</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-xs text-white/30 text-center py-8">
            No activity found.
          </p>
        )}
        {filtered.map((event) => {
          const actor = getActorType(event);
          return (
            <div
              key={event.id}
              className="flex gap-2 items-start py-1.5"
            >
              <span
                className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${ACTOR_COLORS[actor]}`}
              >
                {actor.slice(0, 3)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/70 truncate">{event.title}</p>
                {event.detail && (
                  <p className="text-[11px] text-white/30 truncate">
                    {event.detail}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-[10px] text-white/25">
                {formatRelative(event.created_at)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
