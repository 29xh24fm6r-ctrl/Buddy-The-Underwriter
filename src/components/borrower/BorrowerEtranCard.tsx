"use client";

import React from "react";

export default function BorrowerEtranCard({ result }: { result: any }) {
  if (!result) {
    return (
      <div className="rounded border bg-white p-4">
        <div className="text-sm font-semibold">E-Tran Readiness</div>
        <div className="mt-2 text-sm text-neutral-600">E-Tran validation not run yet</div>
      </div>
    );
  }

  const ready = result.ready ?? false;
  const eligible = result.etran_eligible ?? false;
  const blockers = result.blockers ?? [];
  const warnings = result.warnings ?? [];
  const score = result.score ?? 0;

  const statusBadge = ready
    ? "✅ Ready for E-Tran"
    : eligible
    ? "🟡 Eligible with warnings"
    : "⛔ Not Ready";

  const statusColor = ready
    ? "bg-green-100 text-green-700"
    : eligible
    ? "bg-yellow-100 text-yellow-700"
    : "bg-red-100 text-red-700";

  return (
    <div className="rounded border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">E-Tran Readiness</div>
        <div className={`text-xs px-2 py-1 rounded ${statusColor}`}>
          {statusBadge}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Readiness Score" value={score} />
        <Stat label="Blockers" value={blockers.length} />
        <Stat label="Warnings" value={warnings.length} />
      </div>

      {blockers.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-red-700">🚨 Blocking Issues</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {blockers.map((b: string, i: number) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {blockers.length === 0 && warnings.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-yellow-700">⚠️ Warnings</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {warnings.map((w: string, i: number) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {ready && (
        <div className="text-sm text-green-700 font-medium">
          🎉 This application is ready for E-Tran submission!
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
