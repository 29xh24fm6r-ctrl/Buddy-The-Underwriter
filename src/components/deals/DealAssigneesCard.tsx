"use client";

import React, { useEffect, useState } from "react";

type Participant = {
  deal_id: string;
  clerk_user_id: string;
  role: string;
  is_active: boolean;
  updated_at?: string | null;
};

export default function DealAssigneesCard({ dealId }: { dealId: string }) {
  const [parts, setParts] = useState<Participant[]>([]);
  const [busy, setBusy] = useState(false);
  const [newUw, setNewUw] = useState("");

  async function refresh() {
    const r = await fetch(`/api/admin/deals/${dealId}/assign-underwriter`, { cache: "no-store" });
    const j = await r.json();
    if (j?.ok) setParts(j.participants ?? []);
  }

  async function assign() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/deals/${dealId}/assign-underwriter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerk_user_id: newUw }),
      });
      const j = await r.json();
      if (!j?.ok) alert(j?.error ?? "Failed to assign");
      await refresh();
      setNewUw("");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [dealId]);

  const active = parts.filter((p) => p.is_active);

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-white">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Assignees</div>
          <div className="text-xs text-gray-600">Deal participants (active)</div>
        </div>
        <button
          className="border rounded px-3 py-1 text-sm hover:bg-gray-50"
          onClick={refresh}
          disabled={busy}
        >
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {active.map((p, i) => (
          <div
            key={`${p.role}:${p.clerk_user_id}:${i}`}
            className="flex items-center justify-between text-sm border-l-4 pl-3 py-2"
            style={{
              borderColor:
                p.role === "underwriter"
                  ? "#3b82f6"
                  : p.role === "borrower"
                  ? "#10b981"
                  : "#6b7280",
            }}
          >
            <div className="truncate flex-1">
              <span className="font-medium capitalize">{p.role}</span>:{" "}
              <code className="text-xs bg-gray-100 px-1 rounded">{p.clerk_user_id}</code>
            </div>
            <div className="flex items-center gap-2">
              {p.updated_at && (
                <div className="text-xs text-gray-500">
                  {new Date(p.updated_at).toLocaleDateString()}
                </div>
              )}
              <button
                className="border rounded px-2 py-1 text-xs hover:bg-gray-100"
                onClick={() => {
                  navigator.clipboard.writeText(p.clerk_user_id);
                  alert(`Copied: ${p.clerk_user_id}`);
                }}
                title="Copy user ID"
              >
                Copy ID
              </button>
            </div>
          </div>
        ))}
        {active.length === 0 && (
          <div className="text-sm text-gray-600 py-4 text-center border rounded bg-gray-50">
            No active participants.
          </div>
        )}
      </div>

      <div className="pt-2 border-t space-y-2">
        <div className="text-sm font-medium">Assign underwriter</div>
        <div className="flex gap-2">
          <input
            className="border rounded px-2 py-1 flex-1 text-sm"
            placeholder="clerk_user_id (user_...)"
            value={newUw}
            onChange={(e) => setNewUw(e.target.value)}
          />
          <button
            className="border rounded px-3 py-1 bg-black text-white text-sm hover:opacity-90 disabled:opacity-40"
            onClick={assign}
            disabled={busy || !newUw}
          >
            {busy ? "Assigning..." : "Assign"}
          </button>
        </div>
        <div className="text-xs text-gray-500">
          Tip: get user IDs from{" "}
          <code className="bg-gray-100 px-1 rounded">/api/admin/users/list</code>.
        </div>
      </div>
    </div>
  );
}
