"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types (mirrored from dealTimeline.ts to avoid server-only import) ──────

type TimelineCategory = "document" | "readiness" | "comms" | "banker_action" | "system";
type TimelineSeverity = "info" | "success" | "warning" | "error";
type TimelineActorType = "borrower" | "banker" | "system" | "provider";

type TimelineEvent = {
  id: string;
  dealId: string;
  timestamp: string;
  category: TimelineCategory;
  title: string;
  description: string;
  actorType: string;
  severity: TimelineSeverity;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadataSafe: Record<string, unknown>;
  href: string | null;
};

type DayGroup = { date: string; events: TimelineEvent[] };

// ── Constants ──────────────────────────────────────────────────────────────

const ALL_CATEGORIES: TimelineCategory[] = ["document", "readiness", "comms", "banker_action", "system"];
const ALL_SEVERITIES: TimelineSeverity[] = ["info", "success", "warning", "error"];
const ALL_ACTORS: TimelineActorType[] = ["borrower", "banker", "system", "provider"];

const CATEGORY_COLORS: Record<TimelineCategory, string> = {
  document: "bg-blue-700",
  readiness: "bg-emerald-700",
  comms: "bg-violet-700",
  banker_action: "bg-amber-700",
  system: "bg-neutral-600",
};

const SEVERITY_BORDER: Record<TimelineSeverity, string> = {
  info: "border-neutral-700",
  success: "border-emerald-700/50",
  warning: "border-amber-700/50",
  error: "border-red-700/50",
};

// ── Sub-components ─────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: TimelineCategory }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-white ${CATEGORY_COLORS[category]}`}>
      {category}
    </span>
  );
}

function SeverityDot({ severity }: { severity: TimelineSeverity }) {
  const colors: Record<string, string> = { info: "bg-neutral-400", success: "bg-emerald-400", warning: "bg-amber-400", error: "bg-red-400" };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[severity] ?? "bg-neutral-400"}`} />;
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "bg-white/20 text-white" : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60"
      }`}
      data-testid="filter-chip"
    >
      {label}
    </button>
  );
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

function formatDate(date: string): string {
  try {
    const d = new Date(date + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch { return date; }
}

// ── Group by day (client-side) ─────────────────────────────────────────────

function groupByDay(events: TimelineEvent[]): DayGroup[] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const date = e.timestamp.slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(e);
  }
  const result: DayGroup[] = [];
  for (const [date, evts] of groups) {
    result.push({ date, events: evts });
  }
  result.sort((a, b) => b.date.localeCompare(a.date));
  return result;
}

// ── Toggle helper ──────────────────────────────────────────────────────────

function toggleSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function BrokerageTimelinePanel({ dealId }: { dealId: string }) {
  const [allEvents, setAllEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state — empty set = show all
  const [categoryFilter, setCategoryFilter] = useState<Set<TimelineCategory>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<Set<TimelineSeverity>>(new Set());
  const [actorFilter, setActorFilter] = useState<Set<TimelineActorType>>(new Set());

  const hasFilters = categoryFilter.size > 0 || severityFilter.size > 0 || actorFilter.size > 0;

  function buildExportHref(format: "markdown" | "json"): string {
    const params = new URLSearchParams();
    params.set("format", format);
    if (categoryFilter.size > 0) params.set("categories", Array.from(categoryFilter).join(","));
    if (severityFilter.size > 0) params.set("severities", Array.from(severityFilter).join(","));
    if (actorFilter.size > 0) params.set("actorTypes", Array.from(actorFilter).join(","));
    return `/api/brokerage/deals/${dealId}/timeline/export?${params.toString()}`;
  }

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/timeline?limit=100`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed to load timeline");
      setAllEvents(json.events ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  // Client-side filtering
  const filteredEvents = allEvents.filter(e => {
    if (categoryFilter.size > 0 && !categoryFilter.has(e.category)) return false;
    if (severityFilter.size > 0 && !severityFilter.has(e.severity)) return false;
    if (actorFilter.size > 0 && !actorFilter.has(e.actorType as TimelineActorType)) return false;
    return true;
  });

  const dayGroups = groupByDay(filteredEvents);

  function resetFilters() {
    setCategoryFilter(new Set());
    setSeverityFilter(new Set());
    setActorFilter(new Set());
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-5" data-testid="brokerage-timeline-panel">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-lg font-semibold text-white">Deal Timeline</div>
          <div className="text-sm text-white/60">Unified activity feed</div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={buildExportHref("markdown")}
            className="rounded bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-600"
            data-testid="timeline-export"
            data-format="markdown"
            download
          >
            Export timeline
          </a>
          <button
            type="button"
            onClick={loadTimeline}
            disabled={loading}
            className="rounded bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-600 disabled:opacity-50"
            data-testid="timeline-refresh"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Filter controls */}
      <div className="space-y-2 mb-4" data-testid="timeline-filters">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-white/40 mr-1">Category:</span>
          {ALL_CATEGORIES.map(c => (
            <FilterChip key={c} label={c.replace("_", " ")} active={categoryFilter.has(c)} onClick={() => setCategoryFilter(toggleSet(categoryFilter, c))} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-white/40 mr-1">Severity:</span>
          {ALL_SEVERITIES.map(s => (
            <FilterChip key={s} label={s} active={severityFilter.has(s)} onClick={() => setSeverityFilter(toggleSet(severityFilter, s))} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-white/40 mr-1">Actor:</span>
          {ALL_ACTORS.map(a => (
            <FilterChip key={a} label={a} active={actorFilter.has(a)} onClick={() => setActorFilter(toggleSet(actorFilter, a))} />
          ))}
        </div>
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="text-xs text-white/50 hover:text-white/80 underline" data-testid="reset-filters">
            Reset filters
          </button>
        )}
      </div>

      {error && <div className="rounded border border-red-700 bg-red-900/30 p-2 text-sm text-red-200 mb-3">{error}</div>}

      {/* Empty states */}
      {!loading && allEvents.length === 0 && !error && (
        <div className="text-sm text-white/50 py-6 text-center" data-testid="timeline-empty">
          No timeline activity yet.
        </div>
      )}

      {!loading && allEvents.length > 0 && filteredEvents.length === 0 && (
        <div className="text-sm text-white/50 py-6 text-center" data-testid="timeline-filtered-empty">
          No activity matches these filters.
        </div>
      )}

      <div className="space-y-4" data-testid="timeline-groups">
        {dayGroups.map((group) => (
          <div key={group.date}>
            <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2" data-testid="timeline-day-header">
              {formatDate(group.date)}
            </div>
            <div className="space-y-1.5">
              {group.events.map((e) => (
                <div
                  key={e.id}
                  className={`rounded-lg border ${SEVERITY_BORDER[e.severity]} bg-black/30 px-3 py-2`}
                  data-testid="timeline-event"
                >
                  <div className="flex items-center gap-2">
                    <SeverityDot severity={e.severity} />
                    <span className="text-sm font-medium text-white">{e.title}</span>
                    <CategoryBadge category={e.category} />
                    {e.href && (
                      <a href={e.href} className="text-xs text-blue-400 hover:text-blue-300 underline" data-testid="timeline-source-link">
                        View source
                      </a>
                    )}
                    <span className="ml-auto text-xs text-white/40">{formatTime(e.timestamp)}</span>
                  </div>
                  {e.description && (
                    <div className="mt-1 text-xs text-white/60 pl-4">{e.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
