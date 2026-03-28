"use client";

/**
 * Phase 65F — Banker Borrower Campaign Panel
 *
 * Lists active campaigns for a deal with status, channels, and controls.
 * White panel for Buddy-owned orchestration state.
 */

import { useState, useEffect, useCallback } from "react";

type Campaign = {
  id: string;
  action_code: string;
  status: string;
  borrower_name: string | null;
  borrower_phone: string | null;
  borrower_email: string | null;
  last_sent_at: string | null;
  created_at: string;
  totalItems: number;
  completedItems: number;
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  queued: "bg-yellow-100 text-yellow-700",
  sent: "bg-blue-100 text-blue-700",
  in_progress: "bg-indigo-100 text-indigo-700",
  completed: "bg-green-100 text-green-700",
  expired: "bg-neutral-100 text-neutral-500",
  cancelled: "bg-red-100 text-red-600",
};

export function BorrowerCampaignPanel({ dealId }: { dealId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower-campaigns`);
      const json = await res.json();
      if (json.ok) setCampaigns(json.campaigns ?? []);
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const handleAction = useCallback(
    async (campaignId: string, action: "resend" | "pause" | "cancel") => {
      await fetch(`/api/deals/${dealId}/borrower-campaigns/${campaignId}/${action}`, {
        method: "POST",
      });
      await fetchCampaigns();
    },
    [dealId, fetchCampaigns],
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="animate-pulse h-20 bg-neutral-100 rounded" />
      </div>
    );
  }

  if (campaigns.length === 0) return null;

  return (
    <section
      data-testid="borrower-campaign-panel"
      className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Borrower Campaigns
      </div>

      {campaigns.map((c) => (
        <div
          key={c.id}
          className="rounded-lg border border-neutral-100 p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-800">
                {formatActionCode(c.action_code)}
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  STATUS_BADGE[c.status] ?? STATUS_BADGE.draft
                }`}
              >
                {c.status.replace("_", " ")}
              </span>
            </div>
            <span className="text-[10px] text-neutral-400">
              {c.completedItems}/{c.totalItems} items
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-neutral-500">
            {c.borrower_phone && <span>SMS: {c.borrower_phone}</span>}
            {c.borrower_email && <span>Email: {c.borrower_email}</span>}
            {c.last_sent_at && (
              <span>
                Last sent: {new Date(c.last_sent_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {c.status !== "completed" && c.status !== "cancelled" && (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleAction(c.id, "resend")}
                className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Resend
              </button>
              <button
                type="button"
                onClick={() => handleAction(c.id, "pause")}
                className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Pause Reminders
              </button>
              <button
                type="button"
                onClick={() => handleAction(c.id, "cancel")}
                className="rounded border border-red-200 bg-white px-2 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function formatActionCode(code: string): string {
  return code
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}
