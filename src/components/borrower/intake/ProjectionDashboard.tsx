"use client";

// src/components/borrower/intake/ProjectionDashboard.tsx
// Phase 85-BPG-B — Live projection dashboard for the SBA assumption interview.
// Runs the forward model client-side on every assumption change (no server
// round-trips) and renders 4 visualization cards.

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import {
  buildBaseYear,
  buildAnnualProjections,
  buildMonthlyProjections,
  computeBreakEven,
  buildSensitivityScenarios,
} from "@/lib/sba/sbaForwardModelBuilder";
import type {
  SBAAssumptions,
  AnnualProjectionYear,
  MonthlyProjection,
  BreakEvenResult,
  SensitivityScenario,
} from "@/lib/sba/sbaReadinessTypes";

// ─── Types ────────────────────────────────────────────────────────────────

type BaseYearFacts = {
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  ebitda: number;
  depreciation: number;
  netIncome: number;
  existingDebtServiceAnnual: number;
};

interface Props {
  token: string;
  assumptions: SBAAssumptions;
}

// Intentionally `unused-var`-exempt: BarChart/Bar are re-imported by Recharts'
// internal type graph but not all chart variants end up in the rendered tree.
// Referencing them keeps tree-shaking stable across Next.js builds.
void BarChart;
void Bar;

// ─── Formatting ───────────────────────────────────────────────────────────

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─── Card: DSCR Gauge ─────────────────────────────────────────────────────

function DSCRGauge({ dscr, threshold = 1.25 }: { dscr: number; threshold?: number }) {
  const max = threshold * 3;
  const pct = Math.min(100, (dscr / max) * 100);
  const thresholdPct = (threshold / max) * 100;
  const passes = dscr >= threshold;
  const color =
    dscr >= threshold * 1.5
      ? "bg-green-500"
      : dscr >= threshold
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="border border-neutral-800 rounded-xl p-4">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-sm font-medium text-gray-300">
          Debt Service Coverage
        </span>
        <span
          className={`text-2xl font-bold ${passes ? "text-green-400" : "text-red-400"}`}
        >
          {dscr >= 99 ? "—" : `${dscr.toFixed(2)}x`}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-neutral-800 overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-white/60"
          style={{ left: `${thresholdPct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-600">0x</span>
        <span className="text-[10px] text-gray-500">SBA min: {threshold}x</span>
        <span className="text-[10px] text-gray-600">{max.toFixed(1)}x</span>
      </div>
      <p className="text-xs mt-2 text-gray-400">
        {dscr >= 99
          ? "No debt service — DSCR not applicable"
          : passes
            ? `Above SBA threshold by ${((dscr / threshold - 1) * 100).toFixed(0)}%`
            : `Below SBA threshold — needs ${((threshold / dscr - 1) * 100).toFixed(0)}% more cash flow`}
      </p>
    </div>
  );
}

// ─── Card: Income Summary Table ───────────────────────────────────────────

const INCOME_ROWS: { label: string; key: keyof AnnualProjectionYear }[] = [
  { label: "Revenue", key: "revenue" },
  { label: "Cost of Goods", key: "cogs" },
  { label: "Gross Profit", key: "grossProfit" },
  { label: "Operating Expenses", key: "operatingExpenses" },
  { label: "EBITDA", key: "ebitda" },
  { label: "Net Income", key: "netIncome" },
  { label: "Debt Service", key: "totalDebtService" },
  { label: "DSCR", key: "dscr" },
];

function IncomeTable({
  baseYear,
  projections,
}: {
  baseYear: AnnualProjectionYear;
  projections: AnnualProjectionYear[];
}) {
  const columns = [baseYear, ...projections];
  const headers = ["Actual", "Year 1", "Year 2", "Year 3"];

  return (
    <div className="border border-neutral-800 rounded-xl p-4 overflow-x-auto">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Income Summary</h3>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left py-1 text-gray-500 font-normal w-32"></th>
            {headers.map((h) => (
              <th key={h} className="text-right py-1 text-gray-500 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {INCOME_ROWS.map((row) => (
            <tr
              key={row.key}
              className={row.key === "dscr" ? "border-t border-neutral-800" : ""}
            >
              <td className="py-1.5 text-gray-400">{row.label}</td>
              {columns.map((col, i) => {
                const raw = col[row.key] as number | undefined;
                const text =
                  row.key === "dscr"
                    ? raw == null
                      ? "—"
                      : raw >= 99
                        ? "—"
                        : `${raw.toFixed(2)}x`
                    : fmtCurrency(raw ?? null);
                return (
                  <td
                    key={i}
                    className="text-right py-1.5 text-gray-300 font-mono"
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Card: Monthly Cash Flow Chart ────────────────────────────────────────

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function CashFlowChart({ monthly }: { monthly: MonthlyProjection[] }) {
  const data = monthly.map((m, i) => ({
    month: MONTH_LABELS[i] ?? `M${i + 1}`,
    netCash: Math.round(m.netCash),
    cumulative: Math.round(m.cumulativeCash),
  }));

  return (
    <div className="border border-neutral-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">
        Monthly Cash Flow — Year 1
      </h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#888" }} />
            <YAxis
              tick={{ fontSize: 10, fill: "#888" }}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: 8,
              }}
              labelStyle={{ color: "#999" }}
              formatter={(value: number | undefined) => [
                `$${(value ?? 0).toLocaleString()}`,
                "",
              ]}
            />
            <Bar
              dataKey="netCash"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
              name="Monthly Net"
            />
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              name="Cumulative"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Card: Break-Even + Scenarios ─────────────────────────────────────────

function BreakEvenAndScenarios({
  breakEven,
  scenarios,
}: {
  breakEven: BreakEvenResult;
  scenarios: SensitivityScenario[];
}) {
  const [activeScenario, setActiveScenario] = useState<
    "base" | "upside" | "downside"
  >("base");
  const active = scenarios.find((s) => s.name === activeScenario);
  const downside = scenarios.find((s) => s.name === "downside");

  return (
    <div className="border border-neutral-800 rounded-xl p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-300">
          Break-Even Analysis
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div className="bg-neutral-800/50 rounded-lg p-3">
            <p className="text-[10px] text-gray-500">Break-even Revenue</p>
            <p className="text-lg font-bold text-gray-200">
              {fmtCurrency(breakEven.breakEvenRevenue)}
            </p>
          </div>
          <div className="bg-neutral-800/50 rounded-lg p-3">
            <p className="text-[10px] text-gray-500">Safety Margin</p>
            <p
              className={`text-lg font-bold ${breakEven.marginOfSafetyPct >= 0.1 ? "text-green-400" : "text-red-400"}`}
            >
              {(breakEven.marginOfSafetyPct * 100).toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-300 mb-2">
          Scenario Analysis
        </h3>
        <div className="flex gap-1 mb-3">
          {scenarios.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveScenario(s.name)}
              className={`flex-1 py-1.5 text-xs rounded-md transition ${
                s.name === activeScenario
                  ? "bg-blue-600 text-white font-medium"
                  : "bg-neutral-800 text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {active && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <ScenarioDscrCell label="Y1 DSCR" value={active.dscrYear1} />
            <ScenarioDscrCell label="Y2 DSCR" value={active.dscrYear2} />
            <ScenarioDscrCell label="Y3 DSCR" value={active.dscrYear3} />
          </div>
        )}
        {downside && (
          <p className="text-xs text-gray-500 mt-2">
            {downside.passesSBAThreshold
              ? "Even with 15% revenue decline, DSCR stays above SBA threshold"
              : "A 15% revenue decline would put DSCR below SBA threshold"}
          </p>
        )}
      </div>
    </div>
  );
}

function ScenarioDscrCell({ label, value }: { label: string; value: number }) {
  const text = value >= 99 ? "—" : `${value.toFixed(2)}x`;
  const color =
    value >= 99
      ? "text-gray-300"
      : value >= 1.25
        ? "text-green-400"
        : "text-red-400";
  return (
    <div className="bg-neutral-800/50 rounded-lg p-2">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{text}</p>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────

export function ProjectionDashboard({ token, assumptions }: Props) {
  const [baseYearFacts, setBaseYearFacts] = useState<BaseYearFacts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/borrower/portal/${token}/base-year`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.baseYear) setBaseYearFacts(json.baseYear);
      } catch {
        // Non-fatal: dashboard just won't render without base-year data
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const projections = useMemo(() => {
    if (!baseYearFacts) return null;
    if (!assumptions.revenueStreams?.length) return null;
    if (assumptions.revenueStreams.every((s) => s.baseAnnualRevenue === 0))
      return null;

    try {
      const baseYear = buildBaseYear(baseYearFacts);
      const annual = buildAnnualProjections(assumptions, baseYear);
      const year1 = annual[0];
      if (!year1) return null;
      const monthly = buildMonthlyProjections(assumptions, year1);
      const breakEven = computeBreakEven(assumptions, year1);
      const scenarios = buildSensitivityScenarios(assumptions, [
        baseYear,
        ...annual,
      ]);
      return { baseYear, annual, monthly, breakEven, scenarios };
    } catch {
      return null;
    }
  }, [assumptions, baseYearFacts]);

  if (loading) return null;
  if (!projections) return null;

  return (
    <div className="space-y-3 mt-4 pt-4 border-t border-neutral-800">
      <h3 className="text-sm font-medium text-gray-400">Live Projections</h3>
      <DSCRGauge dscr={projections.annual[0]?.dscr ?? 0} />
      <IncomeTable
        baseYear={projections.baseYear}
        projections={projections.annual}
      />
      <CashFlowChart monthly={projections.monthly} />
      <BreakEvenAndScenarios
        breakEven={projections.breakEven}
        scenarios={projections.scenarios}
      />
    </div>
  );
}
