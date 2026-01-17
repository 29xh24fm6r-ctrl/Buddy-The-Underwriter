"use client";

import React, { useEffect, useMemo, useState } from "react";

type DemoItem = {
  email: string;
  role: string;
  created_at: string | null;
  last_seen_at: string | null;
  last_path: string | null;
  counts: {
    pageviews_24h: number;
    clicks_24h: number;
    actions_7d: number;
  };
};

type DemoListResponse = {
  ok: boolean;
  items: DemoItem[];
  top_routes_7d: Array<{ route: string; count: number }>;
  top_ctas_7d: Array<{ label: string; count: number }>;
  top_actions_7d?: Array<{ label: string; count: number }>;
  top_dropoffs_30m?: Array<{ route: string; count: number }>;
  error?: string;
};

const ROLE_OPTIONS = ["banker", "admin"];

function formatTs(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export default function DemoAccessClient() {
  const [items, setItems] = useState<DemoItem[]>([]);
  const [topRoutes, setTopRoutes] = useState<Array<{ route: string; count: number }>>([]);
  const [topCtas, setTopCtas] = useState<Array<{ label: string; count: number }>>([]);
  const [topActions, setTopActions] = useState<Array<{ label: string; count: number }>>([]);
  const [topDropoffs, setTopDropoffs] = useState<Array<{ route: string; count: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("banker");

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/demo/access/list", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as DemoListResponse | null;
      if (!json?.ok) throw new Error(json?.error || "Failed to load demo access");
      setItems(json.items || []);
      setTopRoutes(json.top_routes_7d || []);
      setTopCtas(json.top_ctas_7d || []);
      setTopActions(json.top_actions_7d || []);
      setTopDropoffs(json.top_dropoffs_30m || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load demo access");
    } finally {
      setBusy(false);
    }
  }

  async function upsert(targetEmail: string, targetRole: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/demo/access/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail, role: targetRole }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to update access");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to update access");
      setBusy(false);
    }
  }

  async function remove(targetEmail: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/demo/access/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to remove access");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to remove access");
      setBusy(false);
    }
  }

  async function seedDemoDeals() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/seed", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Seed failed");
      await load();
    } catch (e: any) {
      setError(e?.message || "Seed failed");
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const disabled = busy || !email.trim();

  const totalPageviews24h = useMemo(
    () => items.reduce((acc, item) => acc + (item.counts?.pageviews_24h ?? 0), 0),
    [items],
  );
  const totalClicks24h = useMemo(
    () => items.reduce((acc, item) => acc + (item.counts?.clicks_24h ?? 0), 0),
    [items],
  );
  const totalActions7d = useMemo(
    () => items.reduce((acc, item) => acc + (item.counts?.actions_7d ?? 0), 0),
    [items],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Demo Access</h1>
          <p className="text-sm text-muted-foreground">
            Invite-only access + usage telemetry for sandbox testers.
          </p>
        </div>
        <button
          className="rounded border px-3 py-1 text-sm"
          onClick={load}
          disabled={busy}
          data-testid="demo-access-refresh"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border p-4">
          <div className="text-sm text-muted-foreground">Pageviews (24h)</div>
          <div className="text-2xl font-semibold">{totalPageviews24h}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-sm text-muted-foreground">Clicks (24h)</div>
          <div className="text-2xl font-semibold">{totalClicks24h}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-sm text-muted-foreground">Actions (7d)</div>
          <div className="text-2xl font-semibold">{totalActions7d}</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Add demo user</div>
            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="banker@bank.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => upsert(email.trim(), role)}
                disabled={disabled}
                data-testid="demo-access-add"
              >
                {busy ? "Saving…" : "Add"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border p-4 overflow-x-auto">
            <div className="text-sm font-semibold mb-3">Allowlist</div>
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Added</th>
                  <th className="py-2 pr-4">Last seen</th>
                  <th className="py-2 pr-4">Last route</th>
                  <th className="py-2 pr-4">24h</th>
                  <th className="py-2 pr-4">Actions 7d</th>
                  <th className="py-2">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.email}>
                    <td className="py-2 pr-4 whitespace-nowrap font-medium">{item.email}</td>
                    <td className="py-2 pr-4">
                      <select
                        className="rounded-md border px-2 py-1 text-xs"
                        value={item.role}
                        onChange={(e) => upsert(item.email, e.target.value)}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">{formatTs(item.created_at)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{formatTs(item.last_seen_at)}</td>
                    <td className="py-2 pr-4 max-w-[200px] truncate">{item.last_path ?? "—"}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {item.counts.pageviews_24h} pv / {item.counts.clicks_24h} cl
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">{item.counts.actions_7d}</td>
                    <td className="py-2">
                      <button
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => remove(item.email)}
                        data-testid={`demo-access-remove-${item.email}`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td className="py-4 text-center text-sm text-muted-foreground" colSpan={8}>
                      No demo users yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Top routes (7d)</div>
            <ul className="mt-3 space-y-2 text-sm">
              {topRoutes.length ? (
                topRoutes.map((r) => (
                  <li key={r.route} className="flex items-center justify-between gap-3">
                    <span className="truncate">{r.route}</span>
                    <span className="text-muted-foreground">{r.count}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">No route data yet.</li>
              )}
            </ul>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Top CTAs (7d)</div>
            <ul className="mt-3 space-y-2 text-sm">
              {topCtas.length ? (
                topCtas.map((c) => (
                  <li key={c.label} className="flex items-center justify-between gap-3">
                    <span className="truncate">{c.label}</span>
                    <span className="text-muted-foreground">{c.count}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">No CTA data yet.</li>
              )}
            </ul>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Top actions (7d)</div>
            <ul className="mt-3 space-y-2 text-sm">
              {topActions.length ? (
                topActions.map((a) => (
                  <li key={a.label} className="flex items-center justify-between gap-3">
                    <span className="truncate">{a.label}</span>
                    <span className="text-muted-foreground">{a.count}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">No action data yet.</li>
              )}
            </ul>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Drop-off routes (30m+ idle)</div>
            <ul className="mt-3 space-y-2 text-sm">
              {topDropoffs.length ? (
                topDropoffs.map((d) => (
                  <li key={d.route} className="flex items-center justify-between gap-3">
                    <span className="truncate">{d.route}</span>
                    <span className="text-muted-foreground">{d.count}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">No drop-offs detected.</li>
              )}
            </ul>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Sandbox actions</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Seed demo deals for new testers.
            </p>
            <button
              className="mt-3 w-full rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              onClick={seedDemoDeals}
              disabled={busy}
              data-testid="demo-access-seed"
            >
              {busy ? "Seeding…" : "Seed demo deals"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
