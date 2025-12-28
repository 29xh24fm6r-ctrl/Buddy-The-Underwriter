"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type ProgressData = {
  confirmed_docs: number;
  total_docs: number;
  received_count: number;
  total_checklist: number;
};

async function j<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export function DealProgressWidget({ dealId }: { dealId: string }) {
  const [data, setData] = React.useState<ProgressData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const progress = await j<ProgressData>(`/api/deals/${dealId}/progress`);
        if (mounted) setData(progress);
      } catch (e: any) {
        if (mounted) setErr(e?.message ?? "Failed to load progress");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 p-4 bg-white">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Icon name="sync" className="h-4 w-4 animate-spin" />
          Loading progress…
        </div>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="rounded-xl border border-red-200 p-4 bg-red-50">
        <div className="flex items-center gap-2 text-sm text-red-900">
          <Icon name="error" className="h-4 w-4" />
          {err || "Failed to load progress"}
        </div>
      </div>
    );
  }

  const docsProgress = data.total_docs > 0 ? Math.round((data.confirmed_docs / data.total_docs) * 100) : 0;
  const checklistProgress = data.total_checklist > 0 ? Math.round((data.received_count / data.total_checklist) * 100) : 0;

  return (
    <div className="rounded-xl border border-neutral-200 p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="fact_check" className="h-5 w-5 text-neutral-900" />
          <h3 className="text-sm font-semibold">Borrower Confirmation Progress</h3>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
        >
          <Icon name="refresh" className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-neutral-600">Documents Confirmed</span>
            <span className="font-medium">
              {data.confirmed_docs} / {data.total_docs}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-emerald-600 transition-all" style={{ width: `${docsProgress}%` }} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-neutral-600">Checklist Items Received</span>
            <span className="font-medium">
              {data.received_count} / {data.total_checklist}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-neutral-900 transition-all" style={{ width: `${checklistProgress}%` }} />
          </div>
        </div>

        {data.confirmed_docs === data.total_docs && data.total_docs > 0 ? (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="flex items-center gap-2">
              <Icon name="check_circle" className="h-4 w-4" />
              <span className="font-semibold">All documents confirmed by borrower</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
