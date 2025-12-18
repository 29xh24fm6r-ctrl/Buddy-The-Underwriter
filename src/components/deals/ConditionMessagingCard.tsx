"use client";

import React, { useEffect, useState } from "react";

interface DraftMessage {
  id: string;
  condition_id: string;
  subject: string;
  body: string;
  priority: string;
  metadata: any;
  created_at: string;
}

interface ConditionMessagingCardProps {
  dealId: string;
}

export default function ConditionMessagingCard({ dealId }: ConditionMessagingCardProps) {
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    loadDrafts();
  }, [dealId]);

  async function loadDrafts() {
    try {
      const r = await fetch(`/api/deals/${dealId}/messages?status=DRAFT`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (j?.ok) {
        setDrafts(j.messages ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function approveSend(messageId: string) {
    setSending(messageId);
    try {
      const r = await fetch(`/api/deals/${dealId}/messages/${messageId}/send`, {
        method: "POST",
      });
      const j = await r.json();
      if (j?.ok) {
        await loadDrafts(); // Refresh list
      } else {
        alert(`Failed to send: ${j?.error}`);
      }
    } finally {
      setSending(null);
    }
  }

  async function deleteDraft(messageId: string) {
    if (!confirm("Delete this draft message?")) return;
    
    try {
      const r = await fetch(`/api/deals/${dealId}/messages/${messageId}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (j?.ok) {
        await loadDrafts();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  if (loading) {
    return <div className="border rounded-lg p-4">Loading messages…</div>;
  }

  if (drafts.length === 0) {
    return (
      <div className="border rounded-lg p-4 bg-white">
        <h3 className="font-semibold mb-2">Borrower Nudges</h3>
        <p className="text-sm text-gray-600">
          No draft messages. Run automation to generate condition-based nudges.
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4 bg-white space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Draft Borrower Nudges</h3>
        <span className="text-sm text-gray-600">{drafts.length} pending approval</span>
      </div>

      <div className="space-y-3">
        {drafts.map((msg) => (
          <div
            key={msg.id}
            className={`border-l-4 p-3 rounded ${
              msg.priority === "HIGH"
                ? "border-red-500 bg-red-50"
                : "border-yellow-500 bg-yellow-50"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="font-medium text-sm">{msg.subject}</div>
                <div className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">
                  {msg.body}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Priority: {msg.priority} | Stall: {msg.metadata?.stall_reason ?? "N/A"}
                </div>
              </div>
              <div className="ml-4 flex gap-2">
                <button
                  className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:opacity-90 disabled:opacity-40"
                  onClick={() => approveSend(msg.id)}
                  disabled={sending === msg.id}
                >
                  {sending === msg.id ? "Sending…" : "Approve & Send"}
                </button>
                <button
                  className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
                  onClick={() => deleteDraft(msg.id)}
                  disabled={sending === msg.id}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
