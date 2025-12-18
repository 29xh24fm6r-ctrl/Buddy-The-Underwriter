"use client";

import { useEffect, useState } from "react";

interface Deal {
  id: string;
  borrower_name: string;
  borrower_entity_type?: string;
  status?: string;
  created_at: string;
  updated_at: string;
}

interface DealHeaderCardProps {
  dealId: string;
}

export default function DealHeaderCard({ dealId }: DealHeaderCardProps) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDeal = async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}`);
        if (!res.ok) throw new Error("Failed to fetch deal");
        const data = await res.json();
        setDeal(data.deal);
      } catch (err) {
        console.error("Error fetching deal:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDeal();
  }, [dealId]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-6 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-500">Deal not found</p>
      </div>
    );
  }

  const timeSinceUpdate = () => {
    const now = new Date();
    const updated = new Date(deal.updated_at);
    const diffMs = now.getTime() - updated.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {/* Deal Identity */}
      <div className="mb-4">
        <h2 className="font-semibold text-lg mb-1">{deal.borrower_name}</h2>
        {deal.borrower_entity_type && (
          <p className="text-sm text-gray-600">{deal.borrower_entity_type}</p>
        )}
      </div>

      {/* Status & Activity */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Status</span>
          <span className="font-medium capitalize">{deal.status || "Active"}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Last Activity</span>
          <span className="font-medium text-gray-900">{timeSinceUpdate()}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Deal ID</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(deal.id);
              alert("Deal ID copied!");
            }}
            className="text-blue-600 hover:text-blue-700 font-mono text-xs"
            title="Click to copy"
          >
            {deal.id.substring(0, 8)}...
          </button>
        </div>
      </div>

      {/* Risk Rating Placeholder */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">Risk Rating</span>
          <span className="text-xs font-medium text-gray-400">TBD</span>
        </div>
      </div>
    </div>
  );
}
