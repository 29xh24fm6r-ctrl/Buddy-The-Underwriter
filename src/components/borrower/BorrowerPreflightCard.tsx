"use client";

import React from "react";

export default function BorrowerPreflightCard({ result }: { result: any }) {
  if (!result) {
    return (
      <div className="rounded border bg-white p-4">
        <div className="text-sm font-semibold">Submission readiness</div>
        <div className="mt-2 text-sm text-neutral-600">Running preflight checks…</div>
      </div>
    );
  }

  const blocks = Array.isArray(result.blocking_issues) ? result.blocking_issues : [];
  const warns = Array.isArray(result.warnings) ? result.warnings : [];
  const score = result.score ?? 0;
  const passed = result.passed ?? false;

  const scoreBadge = score >= 90 ? "🟢" : score >= 70 ? "🟡" : "🔴";
  const statusBadge = passed ? "✅ Ready" : "⛔ Blocked";

  return (
    <div className="rounded border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Submission readiness</div>
        <div className="text-xs">{statusBadge}</div>
      </div>

      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-bold">{scoreBadge} {score}</div>
        <div className="text-sm text-neutral-500">/ 100</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Blocking issues" value={blocks.length} color={blocks.length > 0 ? "red" : "green"} />
        <Stat label="Warnings" value={warns.length} color={warns.length > 0 ? "yellow" : "green"} />
      </div>

      {blocks.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-red-700">🚨 Fix these before submission</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {blocks.map((b: any, i: number) => (
              <li key={i}>
                <span className="font-semibold">{b.code}:</span> {b.message}
                {b.evidence?.ref && (
                  <div className="text-[11px] text-neutral-500">
                    {b.evidence.source}: {b.evidence.ref}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocks.length === 0 && warns.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-yellow-700">⚠️ Review these warnings</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {warns.map((w: any, i: number) => (
              <li key={i}>
                <span className="font-semibold">{w.code}:</span> {w.message}
                {w.evidence?.ref && (
                  <div className="text-[11px] text-neutral-500">
                    {w.evidence.source}: {w.evidence.ref}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocks.length === 0 && warns.length === 0 && (
        <div className="text-sm text-green-700 font-medium">
          🎉 All checks passed! Ready for submission.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: any; color: "red" | "yellow" | "green" }) {
  const bgColor = color === "red" ? "bg-red-50" : color === "yellow" ? "bg-yellow-50" : "bg-green-50";
  const textColor = color === "red" ? "text-red-700" : color === "yellow" ? "text-yellow-700" : "text-green-700";
  
  return (
    <div className={`rounded border p-2 ${bgColor}`}>
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className={`text-sm font-semibold ${textColor}`}>{value}</div>
    </div>
  );
}
