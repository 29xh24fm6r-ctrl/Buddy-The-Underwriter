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
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    const r = await fetch(`/api/deals/${dealId}/participants`, {
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (!j?.ok) {
      setError(j?.error ?? "Failed to load participants");
      setParts([]);
      return;
    }
    setParts(j.participants ?? []);
  }

  async function assign() {
    setBusy(true);
    try {
      const r = await fetch(`/api/deals/${dealId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: newUw, role: "underwriter" }),
      });
      const j = await r.json().catch(() => null);
      if (!j?.ok) {
        alert(j?.error ?? "Failed to assign");
        return;
      }
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
        {error && (
          <div className="text-sm text-red-700 py-2 px-3 border border-red-200 rounded bg-red-50">
            {error}
          </div>
        )}
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
          Note: assignment requires super-admin or deal bank-admin.
        </div>
      </div>
    </div>
  );
}
