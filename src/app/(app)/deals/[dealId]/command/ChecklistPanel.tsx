"use client";

import React, { useEffect, useState } from "react";
import { UI_EVENT_CHECKLIST_REFRESH } from "@/lib/events/uiEvents";

// Helper for relative time display
function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "Updated just now";
  if (diffSec < 60) return `Updated ${diffSec}s ago`;
  
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Updated ${diffMin}m ago`;
  
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `Updated ${diffHour}h ago`;
  
  return `Updated ${Math.floor(diffHour / 24)}d ago`;
}

type ChecklistItem = {
  id: string;
  checklistKey: string;
  title: string;
  description?: string | null;
  required: boolean;
  receivedAt?: string | null;
  status?: string | null;
  matchConfidence?: number | null;
  matchReason?: string | null;
};

type ChecklistBucket = {
  received: ChecklistItem[];
  pending: ChecklistItem[];
  optional: ChecklistItem[];
};

export function ChecklistPanel({ dealId }: { dealId: string }) {
  const [checklist, setChecklist] = useState<ChecklistBucket | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{
    tone: "info" | "error" | "processing";
    title: string;
    message: string;
  } | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [failCount, setFailCount] = useState(0);
  const [lastGoodData, setLastGoodData] = useState<{
    checklist: ChecklistBucket;
    items: ChecklistItem[];
  } | null>(null);

  const fetchChecklist = React.useCallback(async (): Promise<void> => {
    try {
      setLoading(true);

      const res = await fetch(`/api/deals/${dealId}/checklist`, {
        cache: "no-store",
      });

      const data = await res.json();

      // CONVERGENCE-SAFE: Never red during normal processing
      
      // Processing state = system actively converging (CALM, AMBER)
      if (data.state === "processing") {
        setStatus({
          tone: "processing",
          title: "Converging…",
          message: "I'm organizing your documents and building the checklist. This usually takes a few seconds.",
        });
        setFailCount(0); // Reset fail count on processing
        // Keep showing last good data if we have it
        if (lastGoodData) {
          setChecklist(lastGoodData.checklist);
          setItems(lastGoodData.items);
        } else {
          setItems([]);
        }
        return;
      }

      // Empty state = not seeded yet (CALM, INFO)
      if (data.state === "empty") {
        setStatus({
          tone: "info",
          title: "Building your checklist",
          message:
            "I'm reviewing the documents you uploaded and generating checklist items automatically.",
        });
        setFailCount(0);
        setItems([]);
        return;
      }

      // Error handling with resilience
      if (!data.ok) {
        setFailCount(prev => prev + 1);
        
        // Only show red after 3 consecutive failures
        if (failCount >= 2) {
          setStatus({
            tone: "error",
            title: "We're having trouble syncing",
            message: data.error ?? "Unexpected error loading checklist",
          });
          // Keep last good data if we have it
          if (!lastGoodData) {
            setItems([]);
          }
        } else {
          // Show calm "syncing" message, keep last good data
          setStatus({
            tone: "info",
            title: "Syncing…",
            message: "Reconnecting to update checklist",
          });
        }
        return;
      }

      // Success: reset fail count, save good data
      setFailCount(0);
      setStatus(null);
      const checklistData = data.checklist || { received: data.received || [], pending: data.pending || [], optional: data.optional || [] };
      setItems(data.items || []);
      setChecklist(checklistData);
      setLastGoodData({
        checklist: checklistData,
        items: data.items || [],
      });
      setLastUpdatedAt(new Date().toISOString());
    } catch (e: any) {
      setFailCount(prev => prev + 1);
      
      // Only show red after 3 consecutive failures
      if (failCount >= 2) {
        setStatus({
          tone: "error",
          title: "We're having trouble syncing",
          message: String(e?.message ?? e),
        });
        if (!lastGoodData) {
          setItems([]);
        }
      } else {
        setStatus({
          tone: "info",
          title: "Syncing…",
          message: "Reconnecting to update checklist",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [dealId, failCount, lastGoodData]);

  useEffect(() => {
    fetchChecklist();
    const onVis = () => {
      if (document.visibilityState === "visible") fetchChecklist();
    };
    const onEvt = (e: any) => {
      const d = e?.detail?.dealId;
      if (!d || d === dealId) fetchChecklist();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(UI_EVENT_CHECKLIST_REFRESH, onEvt as any);
    const t = window.setInterval(fetchChecklist, 15000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(UI_EVENT_CHECKLIST_REFRESH, onEvt as any);
      window.clearInterval(t);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Document Checklist</h3>
        </div>
        <div className="text-sm text-gray-500">Loading checklist...</div>
      </div>
    );
  }

  // Show status narrator (info, processing, or error)
  if (status) {
    const toneClass = 
      status.tone === "error" ? "border-red-200 bg-red-50" :
      status.tone === "processing" ? "border-amber-200 bg-amber-50" :
      "border-blue-200 bg-blue-50";
    
    const titleClass = 
      status.tone === "error" ? "text-red-900" :
      status.tone === "processing" ? "text-amber-900" :
      "text-blue-900";
    
    const messageClass = 
      status.tone === "error" ? "text-red-700" :
      status.tone === "processing" ? "text-amber-700" :
      "text-blue-700";

    return (
      <div className={`rounded-lg border p-4 ${toneClass}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-sm font-semibold ${titleClass}`}>{status.title}</h3>
          {status.tone === "error" && (
            <button
              onClick={fetchChecklist}
              className="text-xs text-red-600 hover:text-red-700 underline"
            >
              Retry
            </button>
          )}
        </div>
        <div className={`text-sm ${messageClass}`}>{status.message}</div>
      </div>
    );
  }

  // No items = show empty state (should be caught by status above, but defensive)
  const totalItems = 
    (checklist?.received.length || 0) + 
    (checklist?.pending.length || 0) + 
    (checklist?.optional.length || 0);

  if (totalItems === 0 && items.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-amber-900">Building checklist</h3>
          <button
            onClick={fetchChecklist}
            className="text-xs text-amber-700 hover:text-amber-800 underline"
          >
            Refresh
          </button>
        </div>
        <div className="text-sm text-amber-700">
          I'm organizing the documents you uploaded. Check back in a moment.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold text-gray-900">Document Checklist</h3>
          {lastUpdatedAt && (
            <div className="text-xs text-gray-500">
              {formatRelativeTime(lastUpdatedAt)}
            </div>
          )}
        </div>
        <button
          onClick={fetchChecklist}
          className="text-xs text-blue-600 hover:text-blue-700 underline"
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      
      <div className="p-4 space-y-4">
        {/* Received */}
        {checklist && checklist.received.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-green-700 uppercase mb-2">
              ✓ Received ({checklist.received.length})
            </div>
            <div className="space-y-2">
              {checklist.received.map((item) => (
                <div key={item.id} className="text-xs text-gray-700 pl-3 border-l-2 border-green-500">
                  {item.title}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending */}
        {checklist && checklist.pending.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-amber-700 uppercase mb-2">
              ⏳ Pending ({checklist.pending.length})
            </div>
            <div className="space-y-2">
              {checklist.pending.map((item) => (
                <div key={item.id} className="text-xs text-gray-700 pl-3 border-l-2 border-amber-500">
                  {item.title}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Optional */}
        {checklist && checklist.optional.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Optional ({checklist.optional.length})
            </div>
            <div className="space-y-2">
              {checklist.optional.map((item) => (
                <div key={item.id} className="text-xs text-gray-500 pl-3 border-l-2 border-gray-300">
                  {item.title}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
