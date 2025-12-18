"use client";

import React, { useEffect, useState } from "react";

export default function SbaServicingCard({ dealId }: { dealId: string }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetch(`/api/deals/${dealId}/sba/servicing/recompute`);
    const j = await r.json();
    setData(j);
  }

  async function recompute() {
    setBusy(true);
    try {
      const r = await fetch(`/api/deals/${dealId}/sba/servicing/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program: "7A", closing_date: null }),
      });
      const j = await r.json();
      setData(j);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { refresh(); }, [dealId]);

  const milestones = data?.milestones ?? [];
  const summary = data?.summary ?? data?.result?.summary ?? null;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">SBA Post-Closing Lifecycle</div>
          <div className="text-sm text-muted-foreground">Milestones + overdue detection + audit trail.</div>
        </div>
        <button disabled={busy} className="border rounded px-3 py-1" onClick={recompute}>
          {busy ? "Working..." : "Recompute"}
        </button>
      </div>

      {summary && (
        <div className="text-sm">
          Open: <b>{summary.open}</b> • Overdue: <b>{summary.overdue}</b> • Completed: <b>{summary.completed}</b>
        </div>
      )}

      <div className="space-y-2">
        {milestones.map((m: any) => (
          <div key={m.id} className="border rounded p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm">{m.name}</div>
              <div className="text-xs">{m.status}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">code={m.code} due={m.due_date ?? "n/a"}</div>
          </div>
        ))}
        {milestones.length === 0 && <div className="text-sm text-muted-foreground">No SBA milestones yet.</div>}
      </div>
    </div>
  );
}
