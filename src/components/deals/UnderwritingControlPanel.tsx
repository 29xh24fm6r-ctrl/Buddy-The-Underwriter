"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export function UnderwritingControlPanel({ dealId }: { dealId: string }) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);

  async function startUnderwriting() {
    setBusy(true);
    setErr(null);
    setResult(null);

    try {
      const data = await j<any>(`/api/deals/${dealId}/underwrite/start`, {
        method: "POST",
      });

      setResult(data);

      if (data.ok) {
        // Refresh page after 2 seconds to show updated status
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to start underwriting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="rocket_launch" className="h-5 w-5 text-neutral-900" />
          <h3 className="text-sm font-semibold">Underwriting Pipeline</h3>
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={startUnderwriting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900 disabled:opacity-60"
      >
        {busy ? (
          <>
            <Icon name="sync" className="h-5 w-5 text-white animate-spin" />
            Starting Pipeline…
          </>
        ) : (
          <>
            <Icon name="play_arrow" className="h-5 w-5 text-white" />
            Start Underwriting
          </>
        )}
      </button>

      <p className="mt-2 text-xs text-neutral-500 text-center">
        Validates checklist, runs confidence review, triggers risk scoring
      </p>

      {err && (
        <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1 text-xs">{err}</div>
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-semibold">✅ Pipeline Started</div>
          <div className="mt-2 space-y-1 text-xs">
            <div>
              Checklist: {result.checklist?.received}/{result.checklist?.required} items
            </div>
            <div>
              Confidence Score: {result.confidence_review?.confidence_score}%
            </div>
            {result.confidence_review?.low_confidence_fields?.length > 0 && (
              <div className="text-amber-800">
                ⚠️ {result.confidence_review.low_confidence_fields.length} fields need
                review
              </div>
            )}
            <div>📧 {result.notifications_queued} notifications queued</div>
          </div>
        </div>
      )}

      {result && !result.ok && result.missing && (
        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">Missing Required Items</div>
          <ul className="mt-2 space-y-1 text-xs">
            {result.missing.map((key: string) => (
              <li key={key}>• {key}</li>
            ))}
          </ul>
          <div className="mt-2 text-xs">
            Progress: {result.progress?.received}/{result.progress?.required}
          </div>
        </div>
      )}
    </div>
  );
}
