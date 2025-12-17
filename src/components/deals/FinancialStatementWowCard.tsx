// src/components/deals/FinancialStatementWowCard.tsx
"use client";

import React from "react";

type Props = {
  c4: any | null;
};

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      {children}
    </span>
  );
}

function pickLast(periods: string[]) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  return periods[periods.length - 1];
}

export default function FinancialStatementWowCard({ c4 }: Props) {
  const pnl = c4?.pnl ?? null;
  const insights = c4?.insights ?? null;

  if (!c4 || c4?.statement_type !== "PNL" || !pnl) {
    return (
      <div className="rounded border p-3">
        <div className="text-sm font-semibold">P&L WOW</div>
        <div className="mt-1 text-sm text-gray-600">No P&L extract available yet.</div>
      </div>
    );
  }

  const periods: string[] = Array.isArray(pnl.periods) ? pnl.periods : [];
  const last = pickLast(periods);

  const rev = last ? pnl?.totals?.revenue?.[last] ?? null : null;
  const gp = last ? pnl?.totals?.gross_profit?.[last] ?? null : null;
  const oi = last ? pnl?.totals?.operating_income?.[last] ?? null : null;
  const ni = last ? pnl?.totals?.net_income?.[last] ?? null : null;

  const gm = last ? insights?.metrics?.gross_margin_pct?.[last] ?? null : null;
  const om = last ? insights?.metrics?.operating_margin_pct?.[last] ?? null : null;
  const nm = last ? insights?.metrics?.net_margin_pct?.[last] ?? null : null;

  // YoY (if present)
  const yoy = last ? insights?.metrics?.yoy_revenue_growth_pct?.[last] ?? null : null;

  const flags: any[] = Array.isArray(insights?.flags) ? insights.flags : [];
  const questions: string[] = Array.isArray(insights?.underwriter_questions)
    ? insights.underwriter_questions
    : [];

  return (
    <div className="rounded border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">P&L WOW</div>
          <div className="mt-1 text-xs text-gray-500">
            Deterministic metrics + explainable red flags (no vibes).
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge>C4</Badge>
          <Badge>P&L</Badge>
          {last ? <Badge>{last}</Badge> : null}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded border p-3">
          <div className="text-xs font-semibold text-gray-700">Snapshot</div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div className="text-gray-500">Revenue</div>
            <div className="text-right font-medium">{fmtMoney(rev)}</div>

            <div className="text-gray-500">Gross Profit</div>
            <div className="text-right font-medium">{fmtMoney(gp)}</div>

            <div className="text-gray-500">Operating Income</div>
            <div className="text-right font-medium">{fmtMoney(oi)}</div>

            <div className="text-gray-500">Net Income</div>
            <div className="text-right font-medium">{fmtMoney(ni)}</div>

            <div className="text-gray-500">Gross Margin</div>
            <div className="text-right font-medium">{fmtPct(gm)}</div>

            <div className="text-gray-500">Op Margin</div>
            <div className="text-right font-medium">{fmtPct(om)}</div>

            <div className="text-gray-500">Net Margin</div>
            <div className="text-right font-medium">{fmtPct(nm)}</div>

            <div className="text-gray-500">Revenue YoY</div>
            <div className="text-right font-medium">{fmtPct(yoy)}</div>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Tip: If units are $000, flags may fire—Buddy will ask you to confirm units.
          </div>
        </div>

        <div className="rounded border p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700">Risk Flags</div>
            <div className="text-xs text-gray-500">{flags.length} detected</div>
          </div>

          {flags.length === 0 ? (
            <div className="mt-2 text-sm text-gray-600">No obvious red flags detected.</div>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {flags.slice(0, 8).map((f, i) => (
                <li key={`${f.flag}-${f.period ?? "na"}-${i}`} className="rounded border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{f.flag}</div>
                    <Badge>{f.severity}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">{f.why}</div>
                  {f.period ? <div className="mt-1 text-[11px] text-gray-500">Period: {f.period}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-3 rounded border p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-gray-700">Underwriter Questions</div>
          <div className="text-xs text-gray-500">Auto-generated</div>
        </div>

        {questions.length === 0 ? (
          <div className="mt-2 text-sm text-gray-600">No questions triggered.</div>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {questions.slice(0, 10).map((q, idx) => (
              <li key={`${idx}-${q}`}>{q}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
