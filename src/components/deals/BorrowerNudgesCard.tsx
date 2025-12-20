"use client";

import * as React from "react";

type Draft = {
  id: string;
  status: "draft" | "approved" | "sent";
  body: string;
  created_at: string;
  meta: any;
};

export function BorrowerNudgesCard(props: { dealId: string; bankerUserId: string }) {
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await fetch(`/api/banker/deals/${props.dealId}/nudges`, {
      method: "GET",
      headers: { "x-user-id": props.bankerUserId },
    });
    const json = await res.json();
    if (!json?.ok) {
      setError(json?.error ?? "Failed to load nudges");
      return;
    }
    setDrafts(json.drafts ?? []);
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 20000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  async function updateBody(draftId: string, body: string) {
    setSavingId(draftId);
    setError(null);
    const res = await fetch(`/api/banker/deals/${props.dealId}/nudges`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": props.bankerUserId },
      body: JSON.stringify({ action: "update_body", draftId, body }),
    });
    const json = await res.json();
    if (!json?.ok) setError(json?.error ?? "Update failed");
    await load();
    setSavingId(null);
  }

  async function approveSend(draftId: string) {
    setSavingId(draftId);
    setError(null);
    const res = await fetch(`/api/banker/deals/${props.dealId}/nudges`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": props.bankerUserId },
      body: JSON.stringify({ action: "approve_send", draftId }),
    });
    const json = await res.json();
    if (!json?.ok) setError(json?.error ?? "Send failed");
    await load();
    setSavingId(null);
  }

  const draftsOnly = drafts.filter((d) => d.status === "draft");
  const recentSent = drafts.filter((d) => d.status === "sent").slice(0, 5);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Borrower Nudges</div>
          <div className="text-xs text-gray-500">Auto-drafted from guard issues. Banker must approve.</div>
        </div>
        <button className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

      <div className="mt-3 space-y-2">
        {draftsOnly.length ? (
          draftsOnly.map((d) => (
            <div key={d.id} className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">
                Draft • {new Date(d.created_at).toLocaleString()}
                {d.meta?.issueCode ? ` • ${d.meta.issueCode}` : ""}
              </div>
              <textarea
                className="mt-2 w-full rounded-md border p-2 text-sm"
                defaultValue={d.body}
                rows={3}
                disabled={savingId === d.id}
                onBlur={(e) => updateBody(d.id, e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => approveSend(d.id)}
                  disabled={savingId === d.id}
                >
                  Approve & Send
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-600">No drafts right now.</div>
        )}
      </div>

      {recentSent.length ? (
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-500">Recently sent</div>
          <div className="mt-2 space-y-2">
            {recentSent.map((d) => (
              <div key={d.id} className="rounded-lg border bg-gray-50 p-2 text-sm text-gray-700">
                ✉️ {d.body}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
