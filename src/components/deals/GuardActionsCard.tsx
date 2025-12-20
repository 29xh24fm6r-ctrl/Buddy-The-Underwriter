"use client";

import * as React from "react";
import { useFixMode } from "@/components/fixmode/FixModeProvider";

type ActionRow = {
  id: string;
  code: string;
  status: "open" | "done";
  title: string;
  detail: string;
  evidence: any[];
  action_target: any;
  updated_at: string;
};

export function GuardActionsCard(props: { dealId: string; bankerUserId: string }) {
  const { jumpTo } = useFixMode();
  const [actions, setActions] = React.useState<ActionRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/banker/deals/${props.dealId}/next-actions`, {
        method: "GET",
        headers: { "x-user-id": props.bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load next actions");
      setActions(json.actions ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(id: string, status: "open" | "done") {
    setError(null);
    const res = await fetch(`/api/banker/deals/${props.dealId}/next-actions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": props.bankerUserId },
      body: JSON.stringify({ id, status }),
    });
    const json = await res.json();
    if (!json?.ok) setError(json?.error ?? "Update failed");
    await load();
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  if (loading) return <div className="rounded-xl border bg-white p-4 text-sm text-gray-600">Loading guard actions…</div>;

  const open = actions.filter((a) => a.status === "open");
  const done = actions.filter((a) => a.status === "done").slice(0, 6);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Guard Actions</div>
          <div className="text-xs text-gray-500">Auto-generated from Underwrite Guard</div>
        </div>
        <button className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      <div className="mt-3 space-y-2">
        {open.length ? (
          open.map((a) => (
            <div key={a.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{a.title}</div>
                  <div className="mt-1 text-sm text-gray-700">{a.detail}</div>

                  {Array.isArray(a.evidence) && a.evidence.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {a.evidence.slice(0, 3).map((e, idx) => (
                        <span key={idx} className="rounded-full border bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
                          {e?.label}: {String(e?.value ?? "—")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-gray-50"
                    onClick={() => jumpTo(a.action_target)}
                  >
                    Fix
                  </button>
                  <button
                    className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                    onClick={() => setStatus(a.id, "done")}
                  >
                    Mark done
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-600">No open actions 🎯</div>
        )}
      </div>

      {done.length ? (
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-500">Recently completed</div>
          <div className="mt-2 space-y-2">
            {done.map((a) => (
              <div key={a.id} className="rounded-lg border bg-gray-50 p-2 text-sm text-gray-700">
                ✅ {a.title}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
