"use client";

import * as React from "react";

type ChecklistItem = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  group: string;
  required: boolean;
  status: "missing" | "received" | "verified";
  completedAt: string | null;
};

type Stats = {
  requiredTotal: number;
  requiredDone: number;
  requiredMissing: number;
  percent: number;
};

export function MissingItemsCard({ dealId, bankerUserId }: { dealId: string; bankerUserId: string }) {
  const [checklist, setChecklist] = React.useState<ChecklistItem[]>([]);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/banker/deals/${dealId}/portal-checklist`, {
        method: "GET",
        headers: { "x-user-id": bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load");
      setChecklist(json.checklist ?? []);
      setStats(json.stats ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, bankerUserId]);

  const missing = checklist.filter((i) => i.required && i.status === "missing");
  const received = checklist.filter((i) => i.required && i.status !== "missing");

  return (
    <div className="rounded-xl border bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Portal checklist</div>
          <div className="mt-1 text-sm text-gray-600">What borrower sees in guided upload mode</div>
        </div>
        <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      {loading ? (
        <div className="mt-3 text-sm text-gray-600">Loading…</div>
      ) : (
        <>
          {stats ? (
            <div className="mt-3 rounded-xl border bg-gray-50 p-4">
              <div className="text-sm font-semibold">
                Progress: {stats.requiredDone} / {stats.requiredTotal} complete ({stats.percent}%)
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                <div className="h-2 rounded-full bg-gray-900" style={{ width: `${stats.percent}%` }} />
              </div>
              <div className="mt-2 text-sm text-gray-600">
                {stats.requiredMissing === 0
                  ? "All required items received ✅"
                  : `${stats.requiredMissing} required items still missing`}
              </div>
            </div>
          ) : null}

          {missing.length > 0 ? (
            <div className="mt-3">
              <div className="text-sm font-semibold text-red-700">Missing ({missing.length})</div>
              <div className="mt-2 space-y-2">
                {missing.map((i) => (
                  <div key={i.id} className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <div className="text-sm font-medium text-red-900">{i.title}</div>
                    {i.description ? <div className="mt-1 text-sm text-red-800">{i.description}</div> : null}
                    <div className="mt-2 text-xs text-red-700">Code: {i.code}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {received.length > 0 ? (
            <div className="mt-3">
              <div className="text-sm font-semibold text-green-700">Received ({received.length})</div>
              <div className="mt-2 space-y-2">
                {received.slice(0, 5).map((i) => (
                  <div key={i.id} className="rounded-lg border bg-white p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-sm font-medium">{i.title}</div>
                      <span className="shrink-0 text-xs text-green-700">
                        {i.status === "verified" ? "Verified ✅" : "Received ✅"}
                      </span>
                    </div>
                    {i.completedAt ? (
                      <div className="mt-1 text-xs text-gray-500">
                        {new Date(i.completedAt).toLocaleString()}
                      </div>
                    ) : null}
                  </div>
                ))}
                {received.length > 5 ? (
                  <div className="text-sm text-gray-600">+ {received.length - 5} more</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
