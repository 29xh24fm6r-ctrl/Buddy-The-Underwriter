"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useChecklistDetail, isProtectedKey, type ChecklistDetailItem } from "../hooks/useChecklistDetail";
import { YearDots, YearSummary } from "./YearDots";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type Filter = "all" | "pending" | "satisfied" | "optional";

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "received" || s === "satisfied") {
    return { label: s.toUpperCase(), className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  }
  if (s === "needs_review") {
    return { label: "REVIEW", className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300" };
  }
  if (s === "waived") {
    return { label: "WAIVED", className: "border-white/20 bg-white/5 text-white/50" };
  }
  if (s === "pending") {
    return { label: "PENDING", className: "border-sky-500/30 bg-sky-500/10 text-sky-300" };
  }
  return { label: "MISSING", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
}

function ChecklistItemRow({
  item,
  dealId,
  onToggleRequired,
}: {
  item: ChecklistDetailItem;
  dealId: string;
  onToggleRequired: (item: ChecklistDetailItem) => void;
}) {
  const badge = statusBadge(item.status);
  const isProtected = isProtectedKey(item.checklist_key);

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border transition-colors",
        item.required
          ? "border-white/5 bg-white/[0.02]"
          : "border-white/[0.03] bg-transparent opacity-60",
      )}
    >
      {/* Status badge */}
      <span
        className={cn(
          "mt-0.5 shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
          badge.className,
        )}
      >
        {badge.label}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white/90 font-medium truncate">{item.title}</span>
          <YearSummary requiredYears={item.required_years} satisfiedYears={item.satisfied_years} />
        </div>
        {item.description && (
          <div className="text-xs text-white/40 mt-0.5 truncate">{item.description}</div>
        )}
        {/* Year dots */}
        {(item.required_years?.length || item.satisfied_years?.length) ? (
          <div className="mt-1.5">
            <YearDots requiredYears={item.required_years} satisfiedYears={item.satisfied_years} />
          </div>
        ) : null}
      </div>

      {/* Required/optional toggle */}
      {!isProtected && (
        <button
          onClick={() => onToggleRequired(item)}
          className={cn(
            "shrink-0 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors",
            item.required
              ? "border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
              : "border-emerald-500/20 text-emerald-400/60 hover:text-emerald-300 hover:border-emerald-500/30",
          )}
          title={item.required ? "Mark as optional" : "Mark as required"}
        >
          {item.required ? "Optional?" : "Required?"}
        </button>
      )}
    </div>
  );
}

type Props = {
  dealId: string;
};

export function YearAwareChecklistPanel({ dealId }: Props) {
  const { items, grouped, isLoading, error, mutate } = useChecklistDetail(dealId);
  const [filter, setFilter] = useState<Filter>("all");
  const [toggling, setToggling] = useState<string | null>(null);

  const handleToggleRequired = useCallback(
    async (item: ChecklistDetailItem) => {
      if (isProtectedKey(item.checklist_key)) return;
      setToggling(item.id);
      try {
        await fetch(`/api/deals/${dealId}/checklist/list`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            itemId: item.id,
            required: !item.required,
          }),
        });
        mutate();
      } catch {
        // Silent fail — next poll will correct
      } finally {
        setToggling(null);
      }
    },
    [dealId, mutate],
  );

  const filteredItems = (() => {
    switch (filter) {
      case "pending":
        return grouped.pending;
      case "satisfied":
        return grouped.satisfied;
      case "optional":
        return grouped.optional;
      default:
        return items;
    }
  })();

  const { counts } = grouped;
  const progressPct = counts.total > 0 ? Math.round((counts.received / counts.total) * 100) : 0;

  if (isLoading) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Checklist</span>
        </div>
        <div className="p-4 text-white/40 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
          Loading checklist...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Checklist</span>
        </div>
        <div className="p-4">
          <div className="text-amber-300 text-sm">{error}</div>
          <button onClick={mutate} className="mt-2 text-xs text-white/60 hover:text-white/80 underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className={glassHeader}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sky-400 text-[18px]">checklist</span>
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">Checklist</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50 font-mono">
              {counts.received}/{counts.total}
            </span>
            <button
              onClick={mutate}
              className="text-white/40 hover:text-white/70 transition-colors"
              title="Refresh"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-white/50">
            <span>{counts.received} of {counts.total} required items received</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                progressPct === 100
                  ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                  : "bg-gradient-to-r from-sky-500 to-sky-400",
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 border-b border-white/5 pb-2">
          {(["all", "pending", "satisfied", "optional"] as Filter[]).map((f) => {
            const count = f === "all" ? items.length : f === "pending" ? counts.pending : f === "satisfied" ? counts.received : counts.optional;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  filter === f
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/60",
                )}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                <span className="ml-1 text-[10px] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Items */}
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="text-center py-6 text-white/30 text-sm">
              {filter === "all" ? "No checklist items yet" : `No ${filter} items`}
            </div>
          ) : (
            filteredItems.map((item) => (
              <ChecklistItemRow
                key={item.id}
                item={item}
                dealId={dealId}
                onToggleRequired={handleToggleRequired}
              />
            ))
          )}
        </div>

        {/* Optional items note */}
        {counts.optional > 0 && filter !== "optional" && (
          <div className="text-[10px] text-white/30 text-center">
            {counts.optional} optional item{counts.optional !== 1 ? "s" : ""} not shown in progress
          </div>
        )}
      </div>
    </div>
  );
}
