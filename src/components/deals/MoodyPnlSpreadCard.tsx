// src/components/deals/MoodyPnlSpreadCard.tsx
"use client";

import React from "react";
import type { MoodyPnlPackage } from "@/lib/finance/moody";

function money(x: number | null | undefined) {
  if (x === null || x === undefined) return "—";
  return Number(x).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function MoodyPnlSpreadCard({ pkg }: { pkg: MoodyPnlPackage }) {
  const period =
    Array.isArray(pkg.periods) && pkg.periods.length > 0
      ? pkg.periods[pkg.periods.length - 1]
      : null;

  if (!period) {
    return (
      <div className="rounded-lg border p-4">
        <div className="mb-1 text-lg font-semibold">Moody-Style Financial Spread (P&amp;L)</div>
        <div className="text-sm text-gray-600">No P&amp;L periods available yet.</div>
      </div>
    );
  }

  const lines = Array.isArray(period.lines) ? period.lines : [];

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-1 text-lg font-semibold">Moody-Style Financial Spread (P&amp;L)</div>

      <div className="mb-4 text-sm text-gray-600">
        Period: <span className="font-medium">{period.period_label}</span> • Source:{" "}
        <span className="font-medium">{pkg.meta.source}</span> • Built:{" "}
        <span className="font-medium">{pkg.meta.built_at_iso}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border p-3">
          <div className="mb-2 text-sm font-semibold">Income Statement (Lines)</div>
          <div className="space-y-1 text-sm">
            {lines.length === 0 ? (
              <div className="text-gray-600">No lines extracted.</div>
            ) : (
              lines.slice(0, 14).map((ln, i) => (
                <Row key={`${ln.label}-${i}`} label={ln.label} value={money(ln.amount)} />
              ))
            )}
          </div>
        </div>

        <div className="rounded border p-3">
          <div className="mb-2 text-sm font-semibold">Highlights</div>
          <div className="space-y-1 text-sm">
            <Row label="Revenue" value={money(period.revenue)} />
            <Row label="EBITDA" value={money(period.ebitda)} />
            <Row label="Net Income" value={money(period.net_income)} />
          </div>

          {Array.isArray(pkg.warnings) && pkg.warnings.length > 0 ? (
            <div className="mt-3 rounded border p-2 text-sm">
              <div className="mb-1 font-semibold">Notes</div>
              <ul className="list-disc pl-5 text-gray-700">
                {pkg.warnings.slice(0, 5).map((w, i) => (
                  <li key={`${w.code}-${i}`}>
                    <span className="font-medium">{w.code}:</span> {w.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-gray-700">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
