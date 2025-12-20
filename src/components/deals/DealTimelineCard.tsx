"use client";

import * as React from "react";

type EventRow = {
  id: string;
  event_type: string;
  title: string;
  detail: string | null;
  created_at: string;
};

export function DealTimelineCard(props: { dealId: string; bankerUserId: string }) {
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await fetch(`/api/banker/deals/${props.dealId}/timeline`, {
      method: "GET",
      headers: { "x-user-id": props.bankerUserId },
    });
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Failed to load timeline");
      return;
    }
    setEvents(json.events ?? []);
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Timeline</div>
          <div className="text-xs text-gray-500">Real events (not heuristics)</div>
        </div>
        <button className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      <div className="mt-3 space-y-2">
        {(events ?? []).slice(0, 12).map((e) => (
          <div key={e.id} className="rounded-lg border p-3">
            <div className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString()}</div>
            <div className="mt-1 text-sm font-semibold">{e.title}</div>
            {e.detail ? <div className="mt-1 text-sm text-gray-700">{e.detail}</div> : null}
          </div>
        ))}

        {(!events || events.length === 0) ? <div className="text-sm text-gray-600">No timeline events yet.</div> : null}
      </div>
    </div>
  );
}
