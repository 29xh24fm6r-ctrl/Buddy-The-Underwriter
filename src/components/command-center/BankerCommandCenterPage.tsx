"use client";

/**
 * Phase 65H — Banker Command Center Page
 *
 * The unified operating surface for bankers.
 * Layout: Summary cards -> Filters -> Queue table + Focus rail
 * Activity drawer slides in per deal.
 *
 * All urgency, blocking party, and actionability are server-derived.
 * This component only renders and dispatches.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BankerQueueItem,
  CommandCenterSummary,
  CommandCenterFilters,
} from "@/core/command-center/types";
import CommandCenterSummaryCards from "./CommandCenterSummaryCards";
import BankerQueueFilters from "./BankerQueueFilters";
import BankerQueueTable from "./BankerQueueTable";
import CommandCenterFocusRail from "./CommandCenterFocusRail";
import CommandCenterActivityDrawer from "./CommandCenterActivityDrawer";
import { BankerCommandCenter } from "./BankerCommandCenter";
import { buildBankerCommandCenterFromDeals } from "@/lib/banker/buildBankerCommandCenterFromDeals";

const EMPTY_SUMMARY: CommandCenterSummary = {
  totalDeals: 0,
  criticalCount: 0,
  urgentCount: 0,
  borrowerWaitingOnBankCount: 0,
  bankWaitingOnBorrowerCount: 0,
  autoAdvancedTodayCount: 0,
  stalePrimaryActionCount: 0,
};

export default function BankerCommandCenterPage() {
  const [items, setItems] = useState<BankerQueueItem[]>([]);
  const [summary, setSummary] = useState<CommandCenterSummary>(EMPTY_SUMMARY);
  const [filters, setFilters] = useState<CommandCenterFilters>({});
  const [loading, setLoading] = useState(true);
  const [executingDealId, setExecutingDealId] = useState<string | null>(null);
  const [activityDealId, setActivityDealId] = useState<string | null>(null);
  const [activityDealName, setActivityDealName] = useState("");

  // ── Fetch surface ───────────────────────────────────────────────────

  const fetchSurface = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (refresh) params.set("refresh", "1");
        if (filters.urgency) params.set("urgency", filters.urgency);
        if (filters.domain) params.set("domain", filters.domain);
        if (filters.blockingParty) params.set("blockingParty", filters.blockingParty);
        if (filters.actionability) params.set("actionability", filters.actionability);
        if (filters.changedSinceViewed) params.set("changedSinceViewed", "1");

        const res = await fetch(`/api/command-center?${params.toString()}`);
        const data = await res.json();
        if (data.ok) {
          setItems(data.items ?? []);
          setSummary(data.summary ?? EMPTY_SUMMARY);
        }
      } catch (err) {
        console.error("[CommandCenter] fetch failed:", err);
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    fetchSurface();
  }, [fetchSurface]);

  // ── Execute action via 65E ──────────────────────────────────────────

  async function handleExecute(dealId: string, actionCode: string) {
    setExecutingDealId(dealId);
    try {
      const res = await fetch(`/api/deals/${dealId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionCode }),
      });
      const data = await res.json();
      if (data.ok) {
        // Refresh the surface to reflect state change
        await fetchSurface(true);
      }
    } catch (err) {
      console.error("[CommandCenter] execute failed:", err);
    } finally {
      setExecutingDealId(null);
    }
  }

  // ── Acknowledge ─────────────────────────────────────────────────────

  async function handleAcknowledge(dealId: string, reasonCode: string) {
    try {
      await fetch("/api/command-center/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, queueReasonCode: reasonCode }),
      });
      // Update local state — mark as acknowledged
      setItems((prev) =>
        prev.map((item) =>
          item.dealId === dealId
            ? { ...item, changedSinceViewed: false }
            : item,
        ),
      );
    } catch (err) {
      console.error("[CommandCenter] acknowledge failed:", err);
    }
  }

  // ── View Activity ───────────────────────────────────────────────────

  function handleViewActivity(dealId: string) {
    const item = items.find((i) => i.dealId === dealId);
    setActivityDealId(dealId);
    setActivityDealName(item?.dealName ?? "Deal");
  }

  // ── Intelligence overview (15O/15P) ─────────────────────────────────
  // Adapter is pure and deterministic. It maps the existing queue rows
  // into operational continuity items; deals without borrower intelligence
  // degrade to safe "Borrower intelligence not available yet" copy.

  const commandCenterVm = useMemo(
    () => buildBankerCommandCenterFromDeals({ deals: items }),
    [items],
  );
  const intelligenceUnavailable = !loading && items.length > 0 && commandCenterVm.summary.totalDeals === 0;

  return (
    <div className="flex flex-col gap-4 p-6 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white/90">Command Center</h1>
          <p className="text-sm text-white/40">
            {summary.totalDeals} active deal{summary.totalDeals !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Intelligence overview — sits above the operational queue */}
      {loading ? (
        <div
          role="status"
          aria-label="Loading command center intelligence"
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
        >
          <div className="h-3 w-40 rounded bg-white/10" />
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-2xl border border-white/5 bg-white/[0.04]"
              />
            ))}
          </div>
        </div>
      ) : intelligenceUnavailable ? (
        <div
          role="region"
          aria-label="Command center intelligence unavailable"
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/60"
        >
          Command center intelligence is unavailable right now. The full deal
          queue is still below.
        </div>
      ) : (
        <BankerCommandCenter viewModel={commandCenterVm} />
      )}

      {/* All Deals — existing operational queue */}
      <section aria-label="All deals" className="flex flex-col gap-4">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/60">
            All Deals
          </h2>
          <span className="text-xs text-white/40">
            Full queue · {items.length} row{items.length === 1 ? "" : "s"}
          </span>
        </header>

        {/* Summary cards */}
        <CommandCenterSummaryCards summary={summary} />

        {/* Filters */}
        <BankerQueueFilters
          filters={filters}
          onChange={setFilters}
          onRefresh={() => fetchSurface(true)}
          loading={loading}
        />

        {/* Main content: Queue table + Focus rail */}
        <div className="flex gap-4 flex-1 min-h-0">
          <div className="flex-1 min-w-0">
            <BankerQueueTable
              items={items}
              onExecute={handleExecute}
              onAcknowledge={handleAcknowledge}
              onViewActivity={handleViewActivity}
              executingDealId={executingDealId}
            />
          </div>
          <CommandCenterFocusRail items={items} />
        </div>
      </section>

      {/* Activity drawer */}
      <CommandCenterActivityDrawer
        dealId={activityDealId}
        dealName={activityDealName}
        onClose={() => setActivityDealId(null)}
      />
    </div>
  );
}
