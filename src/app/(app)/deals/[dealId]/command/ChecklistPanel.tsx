"use client";

import { useCallback, useEffect, useState } from "react";

type ChecklistItem = {
  id: string;
  checklist_key: string;
  title: string;
  required: boolean;
};

type ChecklistResponse = {
  ok: boolean;
  state: "empty" | "ready";
  received: ChecklistItem[];
  pending: ChecklistItem[];
  optional: ChecklistItem[];
};

export function ChecklistPanel({ dealId }: { dealId: string }) {
  const [data, setData] = useState<ChecklistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const fetchChecklist = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/checklist`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load checklist");
      const json = (await res.json()) as ChecklistResponse;
      setData(json);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      console.error("Checklist fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchChecklist]);

  // Initial load + polling
  useEffect(() => {
    fetchChecklist();
    const interval = setInterval(fetchChecklist, 15000);
    return () => clearInterval(interval);
  }, [fetchChecklist]);

  // Refresh when tab becomes visible
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchChecklist();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchChecklist]);

  if (loading || !data) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="text-sm font-medium text-amber-900">
          Document Checklist
        </div>
        <div className="mt-2 text-sm text-amber-700">
          Initializing checklist…
        </div>
      </div>
    );
  }

  const { received, pending, optional } = data;
  const totalItems = received.length + pending.length + optional.length;

  if (totalItems === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="text-sm font-medium text-amber-900">
          Document Checklist
        </div>
        <div className="mt-2 text-sm text-amber-700">
          Initializing checklist…
        </div>
        <div className="mt-1 text-xs text-amber-600">
          Your documents are saved. The checklist will appear automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            Document Checklist
          </div>
          {lastUpdatedAt && (
            <div className="text-xs text-gray-500">Updated just now</div>
          )}
        </div>
        <button
          onClick={fetchChecklist}
          className="text-xs text-blue-600 hover:text-blue-700 underline"
        >
          Refresh
        </button>
      </div>

      <div className="divide-y divide-gray-100">
        {received.map((item) => (
          <Row key={item.id} item={item} status="received" />
        ))}
        {pending.map((item) => (
          <Row key={item.id} item={item} status="pending" />
        ))}
        {optional.map((item) => (
          <Row key={item.id} item={item} status="optional" />
        ))}
      </div>
    </div>
  );
}

function Row({
  item,
  status,
}: {
  item: ChecklistItem;
  status: "received" | "pending" | "optional";
}) {
  const dotColor =
    status === "received"
      ? "bg-green-500"
      : status === "pending"
      ? "bg-amber-500"
      : "bg-gray-300";

  return (
    <div className="flex items-center gap-3 p-3">
      <div className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
      <div className="flex-1">
        <div className="text-sm text-gray-900">{item.title}</div>
        {!item.required && (
          <div className="text-xs text-gray-500">Optional</div>
        )}
      </div>
    </div>
  );
}
