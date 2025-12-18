"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ux/Badge";

interface DraftMessage {
  id: string;
  condition_id: string;
  draft_message?: string;
  approved_message?: string;
  approved_by?: string;
  approved_at?: string;
  sent_at?: string;
  created_at: string;
}

interface DraftMessagesCardProps {
  dealId: string;
}

export default function DraftMessagesCard({ dealId }: DraftMessagesCardProps) {
  const [messages, setMessages] = useState<DraftMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Error fetching messages:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [dealId]);

  const handleApprove = async (messageId: string) => {
    setApproving(messageId);
    try {
      const res = await fetch(`/api/deals/${dealId}/messages/${messageId}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Approval failed");
      await fetchMessages(); // Refresh list
    } catch (err) {
      console.error("Error approving message:", err);
      alert("Failed to approve message");
    } finally {
      setApproving(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-8 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  const pendingDrafts = messages.filter((m) => !m.approved_at && !m.sent_at);
  const approvedNotSent = messages.filter((m) => m.approved_at && !m.sent_at);
  const sent = messages.filter((m) => m.sent_at);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="mb-3">
        <h3 className="font-semibold text-sm mb-1">Borrower Messages</h3>
        <p className="text-xs text-gray-600">Draft approval queue</p>
      </div>

      {/* Pending Drafts */}
      {pendingDrafts.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs font-medium text-gray-700">Pending Approval</p>
            <Badge variant="warning">{pendingDrafts.length}</Badge>
          </div>
          <div className="space-y-2">
            {pendingDrafts.map((msg) => (
              <div key={msg.id} className="p-3 rounded border border-amber-200 bg-amber-50">
                <div className="flex items-start justify-between mb-2">
                  <Badge variant="warning">Draft</Badge>
                  <span className="text-xs text-gray-600">
                    {new Date(msg.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mb-3">{msg.draft_message}</p>
                <button
                  onClick={() => handleApprove(msg.id)}
                  disabled={approving === msg.id}
                  className="w-full py-1.5 px-3 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {approving === msg.id ? "Approving..." : "Approve & Send"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved Not Sent */}
      {approvedNotSent.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs font-medium text-gray-700">Approved (Queued)</p>
            <Badge variant="info">{approvedNotSent.length}</Badge>
          </div>
          <div className="space-y-2">
            {approvedNotSent.map((msg) => (
              <div key={msg.id} className="p-3 rounded border border-blue-200 bg-blue-50">
                <p className="text-sm text-gray-700 mb-1">{msg.approved_message}</p>
                <p className="text-xs text-gray-600">
                  Approved {msg.approved_at && new Date(msg.approved_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sent Log */}
      {sent.length > 0 && (
        <details className="border-t border-gray-200 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-700 hover:text-gray-900">
            Sent Messages ({sent.length})
          </summary>
          <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
            {sent.map((msg) => (
              <div key={msg.id} className="p-2 rounded border border-gray-200 bg-gray-50">
                <p className="text-xs text-gray-700 mb-1">{msg.approved_message}</p>
                <p className="text-xs text-gray-500">
                  Sent {msg.sent_at && new Date(msg.sent_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Empty State */}
      {messages.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500 mb-1">No messages yet</p>
          <p className="text-xs text-gray-400">System will generate borrower nudges automatically</p>
        </div>
      )}
    </div>
  );
}
