"use client";

import React, { useEffect, useState } from "react";
import { presentEvent } from "@/lib/ledger/present";
import type { AuditLedgerRow } from "@/types/db";

export function EventsFeed({ dealId }: { dealId: string }) {
  const [events, setEvents] = useState<AuditLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/deals/${dealId}/events?limit=10`, {
        cache: "no-store",
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Failed to fetch events");
      }

      setEvents(data.events || []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchEvents();
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
        </div>
        <div className="text-sm text-gray-500">Loading events...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-red-900">Recent Activity</h3>
          <button
            onClick={fetchEvents}
            className="text-xs text-red-600 hover:text-red-700 underline"
          >
            Retry
          </button>
        </div>
        <div className="text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
          <button
            onClick={fetchEvents}
            className="text-xs text-gray-600 hover:text-gray-700 underline"
          >
            Refresh
          </button>
        </div>
        <div className="text-sm text-gray-500 italic">No recent activity</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
        <button
          onClick={fetchEvents}
          className="text-xs text-blue-600 hover:text-blue-700 underline"
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      
      <div className="divide-y divide-gray-100">
        {events.map((event) => {
          // Guard against missing kind field
          if (!event.kind) return null;
          
          const presented = presentEvent({
            kind: event.kind,
            input_json: event.input_json || event.inputJson,
            created_at: event.created_at || event.createdAt || new Date().toISOString(),
          });
          
          return (
            <div key={event.id} className="p-3 hover:bg-gray-50 transition-colors">
              <div className="text-sm font-medium text-gray-900 mb-1">
                {presented.title}
              </div>
              {presented.detail && (
                <div className="text-xs text-gray-600 mb-1">{presented.detail}</div>
              )}
              <div className="text-xs text-gray-500">
                {formatTimestamp(event.created_at || event.createdAt)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return "Unknown time";
  
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "Unknown time";
  }
}
