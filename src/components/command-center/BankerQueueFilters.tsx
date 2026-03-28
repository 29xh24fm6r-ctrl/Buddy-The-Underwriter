"use client";

/**
 * Phase 65H — Queue Filters
 *
 * Filters: urgency, domain, blocking party, actionability, changed since viewed.
 */

import type { CommandCenterFilters } from "@/core/command-center/types";

type Props = {
  filters: CommandCenterFilters;
  onChange: (filters: CommandCenterFilters) => void;
  onRefresh: () => void;
  loading: boolean;
};

const URGENCY_OPTIONS = [
  { value: "", label: "All Urgency" },
  { value: "critical", label: "Critical" },
  { value: "urgent", label: "Urgent" },
  { value: "watch", label: "Watch" },
  { value: "healthy", label: "Healthy" },
];

const DOMAIN_OPTIONS = [
  { value: "", label: "All Domains" },
  { value: "documents", label: "Documents" },
  { value: "borrower", label: "Borrower" },
  { value: "readiness", label: "Readiness" },
  { value: "builder", label: "Builder" },
  { value: "underwriting", label: "Underwriting" },
  { value: "memo", label: "Memo" },
  { value: "pricing", label: "Pricing" },
  { value: "committee", label: "Committee" },
  { value: "closing", label: "Closing" },
  { value: "general", label: "General" },
];

const BLOCKING_OPTIONS = [
  { value: "", label: "All Parties" },
  { value: "banker", label: "Banker" },
  { value: "borrower", label: "Borrower" },
  { value: "buddy", label: "Buddy" },
  { value: "mixed", label: "Mixed" },
];

const ACTIONABILITY_OPTIONS = [
  { value: "", label: "All Actions" },
  { value: "execute_now", label: "Execute Now" },
  { value: "review_required", label: "Review Required" },
  { value: "open_panel", label: "Open Panel" },
  { value: "waiting_on_borrower", label: "Waiting on Borrower" },
  { value: "monitor_only", label: "Monitor Only" },
];

export default function BankerQueueFilters({
  filters,
  onChange,
  onRefresh,
  loading,
}: Props) {
  function update(key: string, value: string) {
    onChange({
      ...filters,
      [key]: value || undefined,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        value={filters.urgency ?? ""}
        onChange={(e) => update("urgency", e.target.value)}
      >
        {URGENCY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        value={filters.domain ?? ""}
        onChange={(e) => update("domain", e.target.value)}
      >
        {DOMAIN_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        value={filters.blockingParty ?? ""}
        onChange={(e) => update("blockingParty", e.target.value)}
      >
        {BLOCKING_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        value={filters.actionability ?? ""}
        onChange={(e) => update("actionability", e.target.value)}
      >
        {ACTIONABILITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-sm text-white/60 cursor-pointer">
        <input
          type="checkbox"
          className="rounded border-white/20 bg-white/5"
          checked={filters.changedSinceViewed ?? false}
          onChange={(e) =>
            onChange({
              ...filters,
              changedSinceViewed: e.target.checked || undefined,
            })
          }
        />
        Changed
      </label>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition disabled:opacity-50"
      >
        {loading ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );
}
