// src/components/deals/MoodyPnlSpreadCard.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { MoodyPnlPackage } from "@/lib/finance/moody";
import { PNL_LINE_LABEL, PNL_LINE_ORDER, type PnlLineId } from "@/lib/finance/moody/pnl-line-catalog";

function money(x: number | null | undefined) {
  if (x === null || x === undefined) return "—";
  return Number(x).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function MoodyPnlSpreadCard({ pkg }: { pkg: MoodyPnlPackage }) {
  const periods = Array.isArray(pkg.periods) ? pkg.periods : [];
  const [idx, setIdx] = useState<number>(Math.max(0, periods.length - 1));

  const period = periods[idx] ?? null;

  const byLabel = useMemo(() => {
    const m = new Map<string, number>();
    if (!period) return m;
    for (const ln of period.lines ?? []) {
      if (ln?.label && typeof ln.amount === "number") m.set(String(ln.label), Number(ln.amount));
    }
    return m;
  }, [period]);

  if (!period) {
    return (
      <div className="rounded-lg border p-4">
        <div className="mb-1 text-lg font-semibold">Moody-Style Financial Spread (P&amp;L)</div>
        <div className="text-sm text-gray-600">No P&amp;L periods available yet.</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-lg font-semibold">Moody-Style Financial Spread (P&amp;L)</div>

        {periods.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            {periods.map((p, i) => (
              <button
                key={`${p.period_label}-${i}`}
                onClick={() => setIdx(i)}
                className={`rounded px-2 py-1 text-xs border ${
                  i === idx ? "bg-black text-white" : "hover:bg-gray-50"
                }`}
              >
                {p.period_label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mb-4 text-sm text-gray-600">
        Period: <span className="font-medium">{period.period_label}</span> • Source:{" "}
        <span className="font-medium">{pkg.meta.source}</span> • Built:{" "}
        <span className="font-medium">{pkg.meta.built_at_iso}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border p-3">
          <div className="mb-2 text-sm font-semibold">Income Statement</div>
          <div className="space-y-1 text-sm">
            {PNL_LINE_ORDER.map((id: PnlLineId) => {
              const label = PNL_LINE_LABEL[id];
              const amt = byLabel.get(label);
              return (
                <Row
                  key={id}
                  label={label}
                  value={money(amt)}
                  strong={id === "GROSS_PROFIT" || id === "NET_INCOME"}
                />
              );
            })}
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
                {pkg.warnings.slice(0, 6).map((w, i) => (
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

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className={`text-gray-700 ${strong ? "font-semibold" : ""}`}>{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
