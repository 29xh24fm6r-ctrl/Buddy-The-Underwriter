"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";

type IndexCode = "UST_5Y" | "SOFR" | "PRIME";

type IndexRate = {
  code: IndexCode;
  label: string;
  ratePct: number;
  asOf: string;
  source: "treasury" | "nyfed" | "fed_h15";
  details?: Record<string, unknown>;
};

type PricingInputs = {
  index_code: IndexCode;
  index_source: string;
  index_tenor: string | null;
  index_rate_pct: number | null;
  loan_amount: number | null;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  spread_override_bps: number | null;
  base_rate_override_pct: number | null;
  notes: string | null;
};

type Deal = {
  id: string;
  borrower_name: string | null;
  stage: string | null;
  risk_score: number | null;
  requested_loan_amount: number | null;
  project_cost: number | null;
  property_value: number | null;
  noi: number | null;
  dscr: number | null;
  ltv: number | null;
};

type Pricing = {
  inputs: Record<string, unknown>;
  risk: { score: number; tier: "A" | "B" | "C" | "D" | "E" };
  decision: "approve" | "review" | "decline";
  quote: { baseRate: number; spreadBps: number; apr: number; maxLoanAmount: number | null };
  explain: Array<{ label: string; detail: string; deltaBps?: number }>;
};

type ComputedPricing = {
  baseRatePct: number;
  spreadBps: number;
  allInRatePct: number;
  rateAsOf: string | null;
};

export default function DealPricingClient({
  deal,
  pricing,
  latestRates,
  inputs,
  computed,
}: {
  deal: Deal;
  pricing: Pricing;
  latestRates: Record<IndexCode, IndexRate> | null;
  inputs: PricingInputs | null;
  computed: ComputedPricing;
}) {
  const [form, setForm] = useState<PricingInputs>(() =>
    normalizeInputs(deal, inputs),
  );
  const [rates, setRates] = useState<Record<IndexCode, IndexRate> | null>(
    latestRates,
  );
  const [status, setStatus] = useState<{
    kind: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const effectiveRate = useMemo(() => {
    if (!rates) return null;
    return rates[form.index_code] ?? rates.SOFR ?? null;
  }, [form.index_code, rates]);

  const baseRatePct =
    form.base_rate_override_pct ??
    effectiveRate?.ratePct ??
    computed.baseRatePct ??
    pricing.quote.baseRate ??
    0;
  const spreadBps =
    form.spread_override_bps ?? computed.spreadBps ?? pricing.quote.spreadBps ?? 0;
  const allInRatePct = baseRatePct + spreadBps / 100;
  const rateAsOf = effectiveRate?.asOf ?? computed.rateAsOf;
  const principal = form.loan_amount ?? deal.requested_loan_amount ?? 0;
  const monthlyRate = allInRatePct / 100 / 12;
  const amortMonths = Math.max(1, form.amort_months || 0);
  const paymentEstimate = calculatePayment(principal, monthlyRate, amortMonths);
  const ioPayment = form.interest_only_months > 0 ? principal * monthlyRate : null;

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        ...form,
        index_source: effectiveRate?.source ?? form.index_source,
        index_tenor: form.index_code === "UST_5Y" ? "5Y" : null,
        index_rate_pct: effectiveRate?.ratePct ?? form.index_rate_pct ?? null,
      };

      const res = await fetch(`/api/deals/${deal.id}/pricing/inputs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to save pricing inputs");
      }

      setForm(normalizeInputs(deal, json.inputs ?? form));
      setStatus({ kind: "success", message: "Saved pricing inputs." });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshRates() {
    setRefreshing(true);
    setStatus(null);
    try {
      const res = await fetch("/api/rates/latest", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to refresh rates");
      }
      setRates(json.rates ?? null);
      setStatus({ kind: "success", message: "Rates refreshed." });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Refresh failed" });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Risk-Based Pricing</h1>
            <p className="text-sm text-slate-600 mt-1">
              Deal: <span className="font-medium">{deal.borrower_name ?? deal.id}</span>
              {deal.stage ? <> · Stage: <span className="font-medium">{deal.stage}</span></> : null}
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              className="px-3 py-2 rounded border text-sm hover:bg-slate-50"
              href={`/deals/${deal.id}/cockpit`}
            >
              Back to Cockpit
            </Link>
          </div>
        </div>

        <section className="grid grid-cols-1 gap-4">
          <Card title="Deal Builder">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Index">
                <select
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.index_code}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      index_code: e.target.value as IndexCode,
                    }))
                  }
                >
                  <option value="SOFR">SOFR</option>
                  <option value="UST_5Y">5Y Treasury</option>
                  <option value="PRIME">Prime</option>
                </select>
              </Field>

              <Field label="Loan Amount">
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  type="number"
                  step="1000"
                  value={form.loan_amount ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      loan_amount: parseNullableNumber(e.target.value),
                    }))
                  }
                  placeholder="e.g. 750000"
                />
              </Field>

              <Field label="Term (months)">
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  type="number"
                  step="1"
                  value={form.term_months}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      term_months: parseNumber(e.target.value, 120),
                    }))
                  }
                />
              </Field>

              <Field label="Amortization (months)">
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  type="number"
                  step="1"
                  value={form.amort_months}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      amort_months: parseNumber(e.target.value, 300),
                    }))
                  }
                />
              </Field>

              <Field label="Interest-Only (months)">
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  type="number"
                  step="1"
                  value={form.interest_only_months}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      interest_only_months: parseNumber(e.target.value, 0),
                    }))
                  }
                />
              </Field>

              <Field label="Base Rate Override (%)">
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  type="number"
                  step="0.01"
                  value={form.base_rate_override_pct ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      base_rate_override_pct: parseNullableNumber(e.target.value),
                    }))
                  }
                  placeholder="Optional"
                />
              </Field>

              <Field label="Spread Override (bps)">
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  type="number"
                  step="1"
                  value={form.spread_override_bps ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      spread_override_bps: parseNullableNumber(e.target.value),
                    }))
                  }
                  placeholder="Optional"
                />
              </Field>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Stat
                label="Base Rate"
                value={`${formatPct(baseRatePct)}%`}
                hint={rateAsOf ? `as of ${rateAsOf}` : ""}
              />
              <Stat label="Spread" value={fmtBps(spreadBps)} />
              <Stat label="All-In Rate" value={`${formatPct(allInRatePct)}%`} emphasize />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save terms"}
              </button>
              <button
                className="rounded border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={handleRefreshRates}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing..." : "Refresh rates"}
              </button>
              {status ? (
                <span
                  className={
                    status.kind === "error"
                      ? "text-sm text-red-600"
                      : "text-sm text-slate-600"
                  }
                >
                  {status.message}
                </span>
              ) : null}
            </div>
          </Card>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="Quoted Rate">
            <div className="text-3xl font-bold">{formatPct(allInRatePct)}%</div>
            <div className="text-sm text-slate-600 mt-1">
              Spread: {fmtBps(spreadBps)} · Base: {formatPct(baseRatePct)}%
            </div>
          </Card>

          <Card title="Risk Score">
            <div className="text-3xl font-bold">{pricing.risk.score}</div>
            <div className="text-sm text-slate-600 mt-1">
              Tier: {pricing.risk.tier} · Decision:{" "}
              <span className={pricing.decision === "approve" ? "text-green-700 font-medium" : "text-amber-700 font-medium"}>
                {pricing.decision.toUpperCase()}
              </span>
            </div>
          </Card>

          <Card title="Payment Estimate">
            <div className="text-3xl font-bold">
              {paymentEstimate > 0 ? money(paymentEstimate) : "—"}
            </div>
            <div className="text-sm text-slate-600 mt-1">
              P&I on {money(principal)} · {form.amort_months} mo amort
            </div>
            {ioPayment != null ? (
              <div className="text-sm text-slate-600 mt-1">
                IO payment: {money(ioPayment)} for {form.interest_only_months} mo
              </div>
            ) : null}
          </Card>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Inputs Used">
            <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto">
              {JSON.stringify({ form, computed: { baseRatePct, spreadBps, allInRatePct } }, null, 2)}
            </pre>
          </Card>

          <Card title="Why This Price">
            <ul className="text-sm space-y-2">
              {pricing.explain.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[2px] inline-block w-2 h-2 rounded-full bg-slate-300" />
                  <span>
                    <span className="font-medium">{x.label}:</span> {x.detail}{" "}
                    {x.deltaBps ? <span className="text-slate-600">({fmtBps(x.deltaBps)})</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4">
          <Card title="Full Pricing Object (Debug)">
            <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto">
              {JSON.stringify(pricing, null, 2)}
            </pre>
          </Card>
        </section>
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-800 mb-2">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm text-slate-700">
      <span className="font-medium text-slate-800">{label}</span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-slate-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={emphasize ? "text-lg font-semibold" : "text-base font-semibold"}>
        {value}
      </div>
      {hint ? <div className="text-xs text-slate-500 mt-1">{hint}</div> : null}
    </div>
  );
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtBps(bps: number) {
  const sign = bps > 0 ? "+" : "";
  return `${sign}${bps} bps`;
}

function formatPct(rate: number) {
  if (!Number.isFinite(rate)) return "0.00";
  return rate.toFixed(3);
}

function parseNullableNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculatePayment(principal: number, monthlyRate: number, n: number) {
  if (!principal || !n) return 0;
  if (!monthlyRate) return principal / n;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
}

function normalizeInputs(deal: Deal, inputs: PricingInputs | null): PricingInputs {
  const base: PricingInputs = {
    index_code: "SOFR",
    index_source: "nyfed",
    index_tenor: null,
    index_rate_pct: null,
    loan_amount: deal.requested_loan_amount ?? null,
    term_months: 120,
    amort_months: 300,
    interest_only_months: 0,
    spread_override_bps: null,
    base_rate_override_pct: null,
    notes: null,
  };

  if (!inputs) return base;

  return {
    ...base,
    ...inputs,
    term_months: inputs.term_months ?? base.term_months,
    amort_months: inputs.amort_months ?? base.amort_months,
    interest_only_months: inputs.interest_only_months ?? base.interest_only_months,
  };
}
