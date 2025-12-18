"use client";

import React, { useEffect, useMemo, useState } from "react";
import { computeNextBestAction } from "@/lib/ux/nextBestAction";

export default function NextBestActionBanner({ dealId }: { dealId: string }) {
  const [signals, setSignals] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetch(`/api/deals/${dealId}/signals`, { cache: "no-store" });
    const j = await r.json();
    if (j?.ok) setSignals(j);
  }

  useEffect(() => {
    refresh();
  }, [dealId]);

  const action = useMemo(() => (signals ? computeNextBestAction(signals) : null), [signals]);

  async function runCta() {
    if (!action?.ctaHref || !action?.ctaAction) return;
    setBusy(true);
    try {
      const r = await fetch(action.ctaHref, {
        method: action.ctaAction,
        headers: { "Content-Type": "application/json" },
        body: action.ctaAction === "POST" ? JSON.stringify(action.ctaBody ?? {}) : undefined,
      });
      await r.json().catch(() => null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!action) return null;

  const bgColor =
    action.severity === "SUCCESS"
      ? "bg-green-50 border-green-200"
      : action.severity === "WARNING"
      ? "bg-amber-50 border-amber-200"
      : "bg-blue-50 border-blue-200";

  const iconColor =
    action.severity === "SUCCESS"
      ? "text-green-600"
      : action.severity === "WARNING"
      ? "text-amber-600"
      : "text-blue-600";

  return (
    <div className={`${bgColor} border rounded-lg p-4 space-y-3`} id="next-best-action">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={`${iconColor} mt-0.5`}>
            {action.severity === "SUCCESS" && <span className="text-xl">✓</span>}
            {action.severity === "WARNING" && <span className="text-xl">⚠</span>}
            {action.severity === "INFO" && <span className="text-xl">→</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{action.title}</div>
            <div className="text-sm text-gray-700 mt-1">{action.subtitle}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {action.ctaHref && !action.ctaAction && (
            <a
              className="border rounded px-3 py-1.5 text-sm bg-white hover:bg-gray-50"
              href={action.ctaHref}
            >
              {action.ctaLabel ?? "Open"}
            </a>
          )}
          {action.ctaAction && (
            <button
              className="border rounded px-3 py-1.5 text-sm bg-white hover:bg-gray-50 disabled:opacity-40"
              onClick={runCta}
              disabled={busy}
            >
              {busy ? "Working..." : action.ctaLabel ?? "Run"}
            </button>
          )}
          <button
            className="border rounded px-3 py-1.5 text-sm bg-white hover:bg-gray-50 disabled:opacity-40"
            onClick={refresh}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
      </div>

      {action.type === "READY_TO_CLOSE" && (
        <div className="text-xs text-gray-600 mt-2 border-t pt-2">
          Deterministic status: evidence-based conditions satisfied.
        </div>
      )}

      {signals && (
        <div className="text-xs text-gray-600 mt-2 border-t pt-2 flex items-center gap-4">
          <span>Jobs: {signals.queuedJobs}Q {signals.runningJobs}R {signals.failedJobs}F</span>
          <span>OCR: {signals.ocrCompletedCount}/{signals.eligibleUploads}</span>
          <span>Conditions: {signals.conditionsOutstanding} outstanding</span>
          {signals.lastEvaluatedAt && (
            <span>Last eval: {new Date(signals.lastEvaluatedAt).toLocaleDateString()}</span>
          )}
        </div>
      )}
    </div>
  );
}
