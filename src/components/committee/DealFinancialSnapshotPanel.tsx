"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import ExportCanonicalMemoPdfButton from "@/components/creditMemo/ExportCanonicalMemoPdfButton";
import { useFinancialSnapshot } from "@/hooks/useFinancialSnapshot";
import type { DealFinancialSnapshotV1, SnapshotMetricName, SnapshotMetricValue } from "@/lib/deals/financialSnapshotCore";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtCurrency(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number) {
  return `${n.toFixed(0)}%`;
}

function fmtRatio(n: number) {
  return `${n.toFixed(2)}x`;
}

function fmtYears(n: number) {
  return `${n.toFixed(2)}y`;
}

function metricLabel(metric: SnapshotMetricName): string {
  const map: Partial<Record<SnapshotMetricName, string>> = {
    total_income_ttm: "Total Income (TTM)",
    noi_ttm: "NOI (TTM)",
    opex_ttm: "OpEx (TTM)",

    cash_flow_available: "Cash Flow Available",
    annual_debt_service: "Annual Debt Service",
    excess_cash_flow: "Excess Cash Flow",
    dscr: "DSCR",
    dscr_stressed_300bps: "Stressed DSCR (+300bps)",

    collateral_gross_value: "Gross Collateral Value",
    collateral_net_value: "Net Collateral Value",
    collateral_discounted_value: "Discounted Collateral Value",
    collateral_coverage: "Discounted Coverage",
    ltv_gross: "Gross LTV",
    ltv_net: "Net LTV",

    in_place_rent_mo: "In-Place Rent / Mo",
    occupancy_pct: "Occupancy %",
    vacancy_pct: "Vacancy %",
    walt_years: "WALT (Years)",

    total_project_cost: "Total Project Cost",
    borrower_equity: "Borrower Equity",
    borrower_equity_pct: "Borrower Equity %",
    bank_loan_total: "Bank Loan Total",
  };
  return map[metric] ?? metric;
}

function formatMetricValue(metric: SnapshotMetricName, v: SnapshotMetricValue | null | undefined): string {
  const n = v?.value_num;
  const t = v?.value_text;
  if (n == null && (t == null || t === "")) return "Pending";

  if (typeof t === "string" && t && n == null) return t;
  if (typeof n !== "number" || !Number.isFinite(n)) return "Pending";

  if (metric.endsWith("_pct")) return fmtPct(n);
  if (metric.startsWith("ltv_")) return fmtPct(n);
  if (metric === "dscr" || metric === "dscr_stressed_300bps") return fmtRatio(n);
  if (metric === "walt_years") return fmtYears(n);

  return fmtCurrency(n);
}

function metricFromSnapshot(snapshot: DealFinancialSnapshotV1, metric: SnapshotMetricName): SnapshotMetricValue {
  return (snapshot as any)[metric] as SnapshotMetricValue;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#111418] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-white/60">{title}</div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Row({ label, value, meta }: { label: string; value: string; meta?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-white truncate">{label}</div>
        {meta ? <div className="text-[11px] text-white/50 truncate">{meta}</div> : null}
      </div>
      <div className="text-sm font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}

export function DealFinancialSnapshotPanel({ dealId }: { dealId: string }) {
  const { data, loading, error, notFound } = useFinancialSnapshot(dealId);
  const [showMissing, setShowMissing] = useState(false);

  const missingKey = showMissing ? `/api/deals/${dealId}/credit-memo/canonical/missing` : null;
  const missing = useSWR(missingKey, fetcher);

  if (notFound) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Deal Financial Snapshot</h2>
          <div className="text-sm text-white/60">Canonical, deterministic metrics (missing values show Pending).</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/credit-memo/${dealId}/canonical`}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white bg-primary hover:bg-primary/90"
          >
            Open Canonical Memo
          </Link>
          <ExportCanonicalMemoPdfButton
            dealId={dealId}
            className="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
            label="Export PDF"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-white/10 bg-[#111418] p-4 text-white/70">Loading snapshot…</div>
      ) : error ? (
        <div className="rounded-lg border border-white/10 bg-[#111418] p-4 text-white/70">
          Snapshot unavailable: <span className="text-white/50">{error}</span>
        </div>
      ) : data?.snapshot ? (
        <SnapshotBody snapshot={data.snapshot} dealId={dealId} onToggleMissing={() => setShowMissing((v) => !v)} showMissing={showMissing} missing={missing.data} missingLoading={missing.isLoading} />
      ) : null}
    </div>
  );
}

function SnapshotBody({
  snapshot,
  dealId,
  onToggleMissing,
  showMissing,
  missing,
  missingLoading,
}: {
  snapshot: DealFinancialSnapshotV1;
  dealId: string;
  onToggleMissing: () => void;
  showMissing: boolean;
  missing: any;
  missingLoading: boolean;
}) {
  const missingCount = snapshot.missing_required_keys?.length ?? 0;
  const ready = missingCount === 0 && (snapshot.completeness_pct ?? 0) >= 99.9;

  const topSources = useMemo(() => {
    const items = (snapshot.sources_summary ?? [])
      .filter((s) => s?.chosen)
      .map((s) => ({
        metric: s.metric,
        chosen: s.chosen,
      }))
      .sort((a, b) => {
        const ca = String((a.chosen as any)?.created_at ?? "");
        const cb = String((b.chosen as any)?.created_at ?? "");
        return cb.localeCompare(ca);
      })
      .slice(0, 5);
    return items;
  }, [snapshot.sources_summary]);

  const badgeClass = ready
    ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30"
    : "bg-amber-600/20 text-amber-200 border-amber-500/30";

  const metaLine = `As of ${snapshot.as_of_date ?? "—"} • Completeness ${snapshot.completeness_pct?.toFixed?.(1) ?? snapshot.completeness_pct}%`;

  return (
    <>
      <div className="rounded-lg border border-white/10 bg-[#111418] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-white/70">{metaLine}</div>
          <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", badgeClass].join(" ")}
            title={missingCount ? `Missing ${missingCount} required metrics` : "All required metrics present"}
          >
            {ready ? "Ready" : `Partial (${missingCount})`}
          </span>
        </div>

        {missingCount ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
              onClick={onToggleMissing}
            >
              {showMissing ? "Hide" : "View"} missing metrics
            </button>
            <div className="text-xs text-white/50">Deal {dealId}</div>
          </div>
        ) : null}

        {showMissing ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
            {missingLoading ? (
              <div className="text-sm text-white/60">Loading missing metrics…</div>
            ) : missing?.ok ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Canonical missing metrics</div>
                {Array.isArray(missing.suggestions) && missing.suggestions.length ? (
                  <ul className="space-y-1 text-sm text-white/70">
                    {missing.suggestions.slice(0, 12).map((s: any) => (
                      <li key={String(s.key)} className="flex gap-2">
                        <span className="text-white/90 font-semibold">{String(s.key)}</span>
                        <span className="text-white/50">— {String(s.suggestion)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-white/60">No suggestions available.</div>
                )}
              </div>
            ) : (
              <div className="text-sm text-white/60">Missing-metrics debug not available.</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Income / Cash Flow">
          {renderRows(snapshot, [
            "total_income_ttm",
            "noi_ttm",
            "opex_ttm",
            "cash_flow_available",
            "annual_debt_service",
            "excess_cash_flow",
            "dscr",
            "dscr_stressed_300bps",
          ])}
        </Section>

        <Section title="Collateral">
          {renderRows(snapshot, [
            "collateral_gross_value",
            "collateral_net_value",
            "collateral_discounted_value",
            "collateral_coverage",
            "ltv_gross",
            "ltv_net",
          ])}
        </Section>

        <Section title="Rent / Tenancy">
          {renderRows(snapshot, ["in_place_rent_mo", "occupancy_pct", "vacancy_pct", "walt_years"])}
        </Section>

        <Section title="Sources & Uses">
          {renderRows(snapshot, ["total_project_cost", "borrower_equity", "borrower_equity_pct", "bank_loan_total"])}
        </Section>
      </div>

      {missingCount ? (
        <div className="rounded-lg border border-white/10 bg-[#111418] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Missing required metrics</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {snapshot.missing_required_keys.slice(0, 24).map((k) => (
              <span key={k} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80">
                {k}
              </span>
            ))}
          </div>
          <div className="mt-3 text-sm text-white/60">Next actions: recompute spreads, run facts backfill, or enter manual values for any Pending fields.</div>
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-[#111418] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Recent sources</div>
        <div className="mt-2 overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-black/20 text-white/60">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider">Metric</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider">Source</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider">As of</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {topSources.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-white/50">No sources available.</td>
                </tr>
              ) : (
                topSources.map((s) => (
                  <tr key={String(s.metric)} className="bg-[#0f1115]">
                    <td className="px-3 py-2 text-white/80">{metricLabel(s.metric as SnapshotMetricName)}</td>
                    <td className="px-3 py-2 text-white/70">
                      {String((s.chosen as any).source_type)}
                      {((s.chosen as any).source_ref ? ` • ${(s.chosen as any).source_ref}` : "") as any}
                    </td>
                    <td className="px-3 py-2 text-white/70">{String((s.chosen as any).as_of_date ?? "—")}</td>
                    <td className="px-3 py-2 text-white/70">{String((s.chosen as any).created_at ?? "—")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function renderRows(snapshot: DealFinancialSnapshotV1, metrics: SnapshotMetricName[]) {
  return metrics.map((m) => {
    const v = metricFromSnapshot(snapshot, m);
    const meta = v?.source_type && v.source_type !== "UNKNOWN" ? `${v.source_type}${v.as_of_date ? ` • as_of ${v.as_of_date}` : ""}` : null;
    return <Row key={m} label={metricLabel(m)} value={formatMetricValue(m, v)} meta={meta} />;
  });
}
