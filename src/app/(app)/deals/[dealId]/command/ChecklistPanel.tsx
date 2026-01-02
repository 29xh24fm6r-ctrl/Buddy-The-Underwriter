"use client";

import React, { useEffect, useState } from "react";

type ChecklistItem = {
  id: string;
  checklistKey: string;
  title: string;
  description?: string | null;
  required: boolean;
  receivedAt?: string | null;
  status?: string | null;
};

type ChecklistBucket = {
  received: ChecklistItem[];
  pending: ChecklistItem[];
  optional: ChecklistItem[];
};

export function ChecklistPanel({ dealId }: { dealId: string }) {
  const [checklist, setChecklist] = useState<ChecklistBucket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChecklist = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/deals/${dealId}/checklist`, {
        cache: "no-store",
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Failed to fetch checklist");
      }

      setChecklist(data.checklist || { received: [], pending: [], optional: [] });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchChecklist();
  }, [fetchChecklist]);

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

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-red-900">Document Checklist</h3>
          <button
            onClick={fetchChecklist}
            className="text-xs text-red-600 hover:text-red-700 underline"
          >
            Retry
          </button>
        </div>
        <div className="text-sm text-red-600">{error}</div>
      </div>
    );
  }

  const totalItems = 
    (checklist?.received.length || 0) + 
    (checklist?.pending.length || 0) + 
    (checklist?.optional.length || 0);

  if (totalItems === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Document Checklist</h3>
          <button
            onClick={fetchChecklist}
            className="text-xs text-gray-600 hover:text-gray-700 underline"
          >
            Refresh
          </button>
        </div>
        <div className="text-sm text-gray-500 italic">No checklist items yet</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Document Checklist</h3>
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
