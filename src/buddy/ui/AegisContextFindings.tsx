"use client";

import React, { useCallback, useState } from "react";
import type { AegisFinding } from "@/buddy/hooks/useAegisHealth";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-l-red-500 bg-red-50",
  error: "border-l-red-400 bg-red-50/50",
  warning: "border-l-amber-400 bg-amber-50/50",
  info: "border-l-blue-400 bg-blue-50/50",
};

const CLASS_LABELS: Record<string, string> = {
  transient: "Transient",
  permanent: "Permanent",
  quota: "Quota",
  auth: "Auth",
  timeout: "Timeout",
  schema: "Schema",
  unknown: "Unknown",
};

function timeAgo(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  const sec = Math.max(0, Math.floor(delta / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function AegisContextFindings({
  findings,
  severity,
  stale,
  onResolve,
}: {
  findings: AegisFinding[];
  severity: string | null;
  stale: boolean;
  onResolve?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const display = expanded ? findings : findings.slice(0, 5);

  const handleResolve = useCallback(
    async (id: string) => {
      try {
        const res = await fetch("/api/aegis/findings/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event_id: id }),
        });
        const data = await res.json();
        if (data?.ok) {
          onResolve?.(id);
        }
      } catch {
        // Fire-and-forget — UI will refresh via polling
      }
    },
    [onResolve],
  );

  if (findings.length === 0) return null;

  return (
    <div className="rounded-xl border border-black/10 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold flex items-center gap-2">
          Aegis Findings
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              severity === "alert"
                ? "bg-red-100 text-red-700 border border-red-200"
                : "bg-amber-100 text-amber-700 border border-amber-200"
            }`}
          >
            {findings.length}
          </span>
        </div>
        {stale && (
          <span className="text-[10px] text-black/40 italic">stale</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {display.map((f) => (
          <div
            key={f.id}
            className={`rounded-lg border border-black/10 border-l-4 p-2 ${
              SEVERITY_COLORS[f.severity] ?? "border-l-gray-300 bg-gray-50/50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {f.errorClass && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/5 text-black/60 shrink-0">
                    {CLASS_LABELS[f.errorClass] ?? f.errorClass}
                  </span>
                )}
                <span className="text-[10px] text-black/50 shrink-0">
                  {f.sourceSystem}
                </span>
              </div>
              <span className="text-[10px] text-black/40 shrink-0">
                {timeAgo(f.createdAt)}
              </span>
            </div>
            <div className="text-[11px] text-black/70 mt-1 truncate">
              {f.errorMessage ?? `${f.eventType} event`}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  f.resolutionStatus === "retrying"
                    ? "bg-blue-100 text-blue-600"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {f.resolutionStatus}
              </span>
              {f.retryAttempt != null && (
                <span className="text-[10px] text-black/40">
                  attempt {f.retryAttempt}
                  {f.maxRetries != null ? `/${f.maxRetries}` : ""}
                </span>
              )}
              <button
                className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-black/10 hover:bg-black/5 text-black/50"
                onClick={() => handleResolve(f.id)}
              >
                Resolve
              </button>
            </div>
          </div>
        ))}
      </div>

      {findings.length > 5 && (
        <button
          className="mt-2 text-[11px] text-black/50 hover:text-black/70"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? "Show fewer"
            : `Show all ${findings.length} findings`}
        </button>
      )}
    </div>
  );
}
