"use client";

import * as React from "react";

type TimelineEvent = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  created_at: string;
};

type DealStatus = {
  deal_id: string;
  stage: string;
  eta_date: string | null;
  eta_note: string | null;
  updated_at: string;
};

type Playbook = {
  stage: string;
  borrower_title: string;
  borrower_steps: string[];
} | null;

type Highlight = {
  highlightIndexes: number[];
  reason: string;
  docType: string | null;
  docYear: number | null;
} | null;

function niceStage(s: string) {
  return s.replaceAll("_", " ");
}

export function BorrowerTimeline(props: { dealId: string }) {
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<DealStatus | null>(null);
  const [playbook, setPlaybook] = React.useState<Playbook>(null);
  const [highlight, setHighlight] = React.useState<Highlight>(null);
  const [events, setEvents] = React.useState<TimelineEvent[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/deals/${props.dealId}/timeline`, { method: "GET" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load timeline");

      setStatus(json.status ?? null);
      setPlaybook(json.playbook ?? null);
      setHighlight(json.highlight ?? null);
      setEvents(json.events ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // light polling keeps it feeling live
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  if (loading) return <div className="text-sm text-gray-600">Loading status…</div>;
  if (error) return <div className="text-sm text-red-700">{error}</div>;

  const highlightSet = new Set<number>((highlight?.highlightIndexes ?? []).map((x) => Number(x)));

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">Current stage</div>
          <div className="text-lg font-semibold">{status?.stage ? niceStage(status.stage) : "—"}</div>
        </div>

        <div className="text-right">
          <div className="text-xs text-gray-500">Estimated timeline</div>
          <div className="text-sm font-medium">
            {status?.eta_date ? status.eta_date : "We'll keep you posted"}
          </div>
        </div>
      </div>

      {status?.eta_note ? (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{status.eta_note}</div>
      ) : null}

      {/* Stage playbook: What happens next */}
      {playbook?.borrower_steps?.length ? (
        <div className="mt-4 rounded-xl border bg-white p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold">What happens next</div>
            <div className="text-xs text-gray-500">{playbook.borrower_title}</div>
          </div>

          {highlight?.reason ? (
            <div className="mt-2 rounded-lg border bg-gray-50 p-2 text-xs text-gray-700">
              {highlight.reason}
            </div>
          ) : null}

          <ul className="mt-3 space-y-2">
            {playbook.borrower_steps.map((step, idx) => {
              const hot = highlightSet.has(idx);
              return (
                <li
                  key={idx}
                  className={[
                    "flex gap-2 rounded-lg p-2 text-sm transition",
                    hot ? "border bg-gray-50" : "border border-transparent",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "mt-[2px] inline-block h-4 w-4 rounded-full border",
                      hot ? "animate-pulse" : "",
                    ].join(" ")}
                    aria-hidden="true"
                  />
                  <span className={hot ? "font-medium" : ""}>{step}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Real timeline events */}
      <div className="mt-4">
        <div className="text-sm font-semibold">Updates</div>
        <div className="mt-2 space-y-2">
          {events.length ? (
            events.map((e) => (
              <div key={e.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{e.title}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(e.created_at).toLocaleString()}
                  </div>
                </div>
                {e.detail ? <div className="mt-1 text-sm text-gray-700">{e.detail}</div> : null}
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-600">No updates yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
