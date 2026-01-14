"use client";

import { useCallback, useMemo, useState } from "react";

type AuditEvent = {
  id: string;
  deal_id: string | null;
  actor_user_id: string | null;
  scope: string | null;
  action: string | null;
  kind: string | null;
  confidence: number | null;
  requires_human_review: boolean | null;
  created_at: string;
};

type Filters = {
  dealId: string;
  actorUserId: string;
  scope: string;
  action: string;
  kind: string;
  requiresHumanReview: "" | "true" | "false";
  q: string;
};

const DEFAULT_FILTERS: Filters = {
  dealId: "",
  actorUserId: "",
  scope: "",
  action: "",
  kind: "",
  requiresHumanReview: "",
  q: "",
};

export default function AuditLedgerClient() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "50");
    if (filters.dealId) params.set("dealId", filters.dealId);
    if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
    if (filters.scope) params.set("scope", filters.scope);
    if (filters.action) params.set("action", filters.action);
    if (filters.kind) params.set("kind", filters.kind);
    if (filters.requiresHumanReview) {
      params.set("requiresHumanReview", filters.requiresHumanReview);
    }
    if (filters.q) params.set("q", filters.q);
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [filters, cursor]);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "50");
        if (filters.dealId) params.set("dealId", filters.dealId);
        if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
        if (filters.scope) params.set("scope", filters.scope);
        if (filters.action) params.set("action", filters.action);
        if (filters.kind) params.set("kind", filters.kind);
        if (filters.requiresHumanReview) {
          params.set("requiresHumanReview", filters.requiresHumanReview);
        }
        if (filters.q) params.set("q", filters.q);
        if (!reset && cursor) params.set("cursor", cursor);

        const res = await fetch(`/api/admin/audit/list?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error ?? "Failed to load audit ledger");
        }

        const nextCursor = data?.nextCursor ?? null;
        const nextEvents = (data?.events ?? []) as AuditEvent[];

        setCursor(nextCursor);
        setEvents((prev) => (reset ? nextEvents : [...prev, ...nextEvents]));
      } catch (err: any) {
        setError(err?.message ?? "Failed to load audit ledger");
      } finally {
        setLoading(false);
      }
    },
    [filters, cursor],
  );

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Audit Ledger</h1>
        <p className="text-sm text-slate-600 mt-1">
          Super-admin view of compliance and system events.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Deal ID"
            value={filters.dealId}
            onChange={(e) => setFilters({ ...filters, dealId: e.target.value })}
          />
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Actor User ID"
            value={filters.actorUserId}
            onChange={(e) => setFilters({ ...filters, actorUserId: e.target.value })}
          />
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Scope"
            value={filters.scope}
            onChange={(e) => setFilters({ ...filters, scope: e.target.value })}
          />
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Action"
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          />
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Kind"
            value={filters.kind}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
          />
          <select
            className="rounded border px-3 py-2 text-sm"
            value={filters.requiresHumanReview}
            onChange={(e) =>
              setFilters({
                ...filters,
                requiresHumanReview: e.target.value as Filters["requiresHumanReview"],
              })
            }
          >
            <option value="">Requires Human Review (any)</option>
            <option value="true">Requires human review</option>
            <option value="false">No human review</option>
          </select>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            className="rounded border px-3 py-2 text-sm md:flex-1"
            placeholder="Search across deal_id, actor_user_id, scope, action, kind"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={() => {
                setCursor(null);
                load(true);
              }}
              disabled={loading}
            >
              {loading ? "Loading…" : "Apply Filters"}
            </button>
            <button
              className="rounded border px-4 py-2 text-sm"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                setCursor(null);
                setEvents([]);
                setError(null);
              }}
              disabled={loading}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Timestamp</th>
              <th className="px-4 py-3 font-semibold">Deal</th>
              <th className="px-4 py-3 font-semibold">Actor</th>
              <th className="px-4 py-3 font-semibold">Scope</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">Kind</th>
              <th className="px-4 py-3 font-semibold">Confidence</th>
              <th className="px-4 py-3 font-semibold">Human Review</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  No events loaded yet.
                </td>
              </tr>
            )}
            {events.map((evt) => (
              <tr key={evt.id} className="border-t">
                <td className="px-4 py-3 whitespace-nowrap">
                  {new Date(evt.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  {evt.deal_id ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  {evt.actor_user_id ?? "—"}
                </td>
                <td className="px-4 py-3">{evt.scope ?? "—"}</td>
                <td className="px-4 py-3">{evt.action ?? "—"}</td>
                <td className="px-4 py-3">{evt.kind ?? "—"}</td>
                <td className="px-4 py-3">
                  {evt.confidence == null ? "—" : `${Math.round(evt.confidence * 100)}%`}
                </td>
                <td className="px-4 py-3">
                  {evt.requires_human_review == null
                    ? "—"
                    : evt.requires_human_review
                      ? "Yes"
                      : "No"}
                </td>
              </tr>
            ))
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center">
        <div className="text-xs text-slate-500">Query: {queryString || "(none)"}</div>
        <button
          className="rounded border px-4 py-2 text-sm"
          onClick={() => load(false)}
          disabled={loading || !cursor}
        >
          {loading ? "Loading…" : cursor ? "Load more" : "No more results"}
        </button>
      </div>
    </div>
  );
}
