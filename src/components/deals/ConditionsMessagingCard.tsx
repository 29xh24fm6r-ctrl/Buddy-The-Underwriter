"use client";

import React, { useEffect, useState } from "react";

export default function ConditionsMessagingCard({ dealId }: { dealId: string }) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [skipped, setSkipped] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function plan() {
    setBusy(true);
    try {
      const r = await fetch(`/api/deals/${dealId}/conditions/messages/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "PORTAL" }),
      });
      const j = await r.json();
      setDrafts(j?.created ?? []);
      setSkipped(j?.skipped ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function send(message_id: string, trigger_key?: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/deals/${dealId}/conditions/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id, trigger_key }),
      });
      const j = await r.json();
      alert(j?.ok ? `Sent: ${j.result.status}` : `Error: ${j.error}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { /* no auto */ }, []);

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Borrower Messaging Autopilot</div>
          <div className="text-sm text-muted-foreground">Rules trigger; AI drafts; you approve/send.</div>
        </div>
        <button disabled={busy} className="border rounded px-3 py-1" onClick={plan}>
          {busy ? "Working..." : "Plan Messages"}
        </button>
      </div>

      {drafts.length > 0 && (
        <div className="space-y-2">
          {drafts.map((m) => (
            <div key={m.id} className="border rounded p-3">
              <div className="text-sm font-medium">{m.subject ?? "(no subject)"}</div>
              <div className="text-xs text-muted-foreground mt-1">
                trigger={m.metadata?.trigger_key ?? "n/a"} severity={m.metadata?.severity ?? "n/a"}
              </div>
              <pre className="text-xs whitespace-pre-wrap mt-2">{m.body}</pre>
              <div className="mt-2 flex gap-2">
                <button disabled={busy} className="border rounded px-3 py-1" onClick={() => send(m.id, m.metadata?.trigger_key)}>
                  Approve & Send
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="border rounded p-3 bg-muted/30">
          <div className="text-sm font-medium">Skipped</div>
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(skipped, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
