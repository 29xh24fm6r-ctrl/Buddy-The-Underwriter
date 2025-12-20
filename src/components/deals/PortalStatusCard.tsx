"use client";

import * as React from "react";

type PortalStatus = {
  stage: string;
  eta_text: string | null;
  updated_at: string;
};

const STAGE_OPTIONS = [
  "Intake",
  "Document Review",
  "Under Review",
  "Underwriting",
  "Approval Committee",
  "Approved - Pending Docs",
  "Closed",
];

export function PortalStatusCard({ dealId, bankerUserId }: { dealId: string; bankerUserId: string }) {
  const [status, setStatus] = React.useState<PortalStatus | null>(null);
  const [stage, setStage] = React.useState("Intake");
  const [etaText, setEtaText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/banker/deals/${dealId}/portal-status`, {
        method: "GET",
        headers: { "x-user-id": bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load");
      const s = json.status;
      setStatus(s);
      setStage(s.stage ?? "Intake");
      setEtaText(s.eta_text ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 20000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, bankerUserId]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/banker/deals/${dealId}/portal-status`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": bankerUserId },
        body: JSON.stringify({ stage, etaText: etaText || null }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Save failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Portal status (borrower-visible)</div>
          <div className="mt-1 text-sm text-gray-600">
            Borrower sees stage + ETA in portal — use friendly language
          </div>
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
          {status ? (
            <div className="mt-3 rounded-xl border bg-gray-50 p-4">
              <div className="text-sm font-semibold">Current borrower-visible status</div>
              <div className="mt-2 text-sm">
                Stage: <span className="font-medium">{status.stage}</span>
              </div>
              {status.eta_text ? (
                <div className="mt-1 text-sm">
                  ETA: <span className="font-medium">{status.eta_text}</span>
                </div>
              ) : (
                <div className="mt-1 text-sm text-gray-600">No ETA set</div>
              )}
              <div className="mt-1 text-xs text-gray-500">
                Last updated: {new Date(status.updated_at).toLocaleString()}
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-medium">Stage (borrower-safe label)</label>
              <select
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                {STAGE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">ETA (optional, borrower-friendly)</label>
              <input
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                value={etaText}
                onChange={(e) => setEtaText(e.target.value)}
                placeholder="e.g., 1–2 business days"
              />
              <div className="mt-1 text-xs text-gray-600">
                Examples: "1–2 business days", "By end of week", "Waiting on appraisal"
              </div>
            </div>

            <button
              className="h-10 w-full rounded-md border bg-gray-900 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Update status (borrower will see timeline event)"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
