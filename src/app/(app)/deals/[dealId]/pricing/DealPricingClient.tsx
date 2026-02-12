"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { SafeMarkdown } from "@/components/ui/SafeMarkdown";

type IndexCode = "UST_5Y" | "SOFR" | "PRIME";

type IndexRate = {
  code: IndexCode;
  label: string;
  ratePct: number;
  asOf: string;
  source: "treasury" | "nyfed" | "fed_h15" | "fred";
  sourceUrl?: string;
  raw?: unknown;
};

type PricingInputs = {
  index_code: IndexCode;
  index_tenor: string | null;
  base_rate_override_pct: number | null;
  spread_override_bps: number | null;
  loan_amount: number | null;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  notes: string | null;
};

type Deal = {
  id: string;
  borrower_name: string | null;
  stage: string | null;
  risk_score: number | null;
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

type QuoteRow = {
  id: string;
  created_at: string;
  index_code: string;
  base_rate_pct: number;
  spread_bps: number;
  all_in_rate_pct: number;
  loan_amount: number;
  term_months: number;
  amort_months: number;
  interest_only_months: number;
  monthly_payment_pi: number | null;
  monthly_payment_io: number | null;
  status?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  lock_reason?: string | null;
  underwriting_snapshot_id?: string | null;
  pricing_policy_id: string | null;
  pricing_policy_version: string | null;
  pricing_model_hash: string | null;
  pricing_explain: any;
  rate_index_snapshots?: {
    id: string;
    as_of_date: string;
    source: string;
    index_rate_pct: number;
    index_label: string;
  } | null;
};

type Explainability = {
  summary: string;
  drivers: Array<{ label: string; bps: number; reason?: string }>;
  missingInputs: Array<{ key: string; label: string; impactBps?: number }>;
  confidence: number;
};

type SnapshotRow = {
  id: string;
  as_of_date: string;
  source: string;
  index_rate_pct: number;
  index_label: string;
} | null;
type ComputedPricing = {
  baseRatePct: number;
  spreadBps: number;
  allInRatePct: number;
  rateAsOf: string | null;
  rateSource: string | null;
};

type ReadinessInfo = {
  spreadsComplete: boolean;
  financialSnapshotExists: boolean;
  researchComplete: boolean;
  stage: string;
};

export default function DealPricingClient({
  deal,
  pricing,
  readinessInfo,
  latestRates,
  inputs,
  quotes,
  loanRequestAmount,
  computed,
}: {
  deal: Deal;
  pricing: Pricing | null;
  readinessInfo: ReadinessInfo | null;
  latestRates: Record<IndexCode, IndexRate> | null;
  inputs: PricingInputs | null;
  quotes: QuoteRow[];
  loanRequestAmount?: number | null;
  computed: ComputedPricing | null;
}) {
  // Gate: if pricing prerequisites are not met, show a "not ready" panel
  if (!pricing || readinessInfo) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-amber-900">
          Pricing Not Available Yet
        </h2>
        <p className="mt-2 text-sm text-amber-800">
          Risk-based pricing requires completed financial analysis and
          institutional research before it can produce accurate, auditable
          results. The following prerequisites must be met:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-amber-800">
          <li className="flex items-center gap-2">
            <span className={readinessInfo?.financialSnapshotExists ? "text-green-600" : "text-amber-600"}>
              {readinessInfo?.financialSnapshotExists ? "\u2713" : "\u25CB"}
            </span>
            Financial snapshot generated from spreads
          </li>
          <li className="flex items-center gap-2">
            <span className={readinessInfo?.spreadsComplete ? "text-green-600" : "text-amber-600"}>
              {readinessInfo?.spreadsComplete ? "\u2713" : "\u25CB"}
            </span>
            All financial spread jobs complete
          </li>
          <li className="flex items-center gap-2">
            <span className={readinessInfo?.researchComplete ? "text-green-600" : "text-amber-600"}>
              {readinessInfo?.researchComplete ? "\u2713" : "\u25CB"}
            </span>
            Institutional research and analysis complete
          </li>
        </ul>
        <p className="mt-4 text-xs text-amber-700">
          Current stage: {readinessInfo?.stage ?? "unknown"}
        </p>
        <Link
          className="mt-3 inline-block px-3 py-2 rounded border text-sm hover:bg-amber-100"
          href={`/deals/${deal.id}/cockpit`}
        >
          Back to Cockpit
        </Link>
      </div>
    );
  }
  const [form, setForm] = useState<PricingInputs>(() =>
    normalizeInputs(deal, inputs, loanRequestAmount ?? null),
  );
  const [rates, setRates] = useState<Record<IndexCode, IndexRate> | null>(
    latestRates,
  );
  const [quoteHistory, setQuoteHistory] = useState<QuoteRow[]>(quotes);
  const [lastSnapshot, setLastSnapshot] = useState<SnapshotRow>(
    quoteHistory?.[0]?.rate_index_snapshots ?? null,
  );
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(
    quotes?.[0]?.id ?? null,
  );
  const [tab, setTab] = useState<"quote" | "explain" | "memo">("quote");
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [explainByQuoteId, setExplainByQuoteId] = useState<
    Record<string, Explainability>
  >({});
  const [memoByQuoteId, setMemoByQuoteId] = useState<Record<string, string>>({});
  const [memoLoadingByQuoteId, setMemoLoadingByQuoteId] = useState<
    Record<string, boolean>
  >({});
  const [memoErrorByQuoteId, setMemoErrorByQuoteId] = useState<
    Record<string, string>
  >({});
  const [busyByQuoteId, setBusyByQuoteId] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{
    kind: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const effectiveRate = useMemo(() => {
    if (!rates) return null;
    return rates[form.index_code] ?? rates.SOFR ?? null;
  }, [form.index_code, rates]);

  const baseRatePct =
    form.base_rate_override_pct ??
    effectiveRate?.ratePct ??
    computed?.baseRatePct ??
    pricing?.quote.baseRate ??
    0;
  const spreadBps =
    form.spread_override_bps ?? computed?.spreadBps ?? pricing?.quote.spreadBps ?? 0;
  const allInRatePct = baseRatePct + spreadBps / 100;
  const rateAsOf = effectiveRate?.asOf ?? computed?.rateAsOf ?? null;
  const rateSource = effectiveRate?.source ?? computed?.rateSource ?? null;
  const principal = form.loan_amount ?? loanRequestAmount ?? 0;
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
        index_tenor: form.index_code === "UST_5Y" ? "5Y" : null,
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
  async function handleQuote() {
    setQuoting(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/deals/${deal.id}/pricing/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to generate quote");
      }
      const nextQuote = json.quote as QuoteRow;
      setQuoteHistory((prev) => [nextQuote, ...prev]);
      setLastSnapshot(json.snapshot ?? null);
      setActiveQuoteId(nextQuote.id);
      setStatus({ kind: "success", message: "Quote generated." });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Quote failed" });
    } finally {
      setQuoting(false);
    }
  }

  async function refreshQuotes() {
    const res = await fetch(`/api/deals/${deal.id}/pricing/quotes`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const json = await res.json();
    const next = json?.quotes ?? [];
    setQuoteHistory(next);
    setLastSnapshot(next?.[0]?.rate_index_snapshots ?? null);
    setActiveQuoteId((prev) => {
      if (prev && next.some((q: QuoteRow) => q.id === prev)) return prev;
      return next?.[0]?.id ?? null;
    });
  }

  async function loadExplainability(quoteId: string) {
    if (!quoteId || explainByQuoteId[quoteId]) return;
    setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: true }));
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/pricing/quote/${quoteId}/explain`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to load explainability");
      }
      setExplainByQuoteId((prev) => ({ ...prev, [quoteId]: json.explain }));
    } finally {
      setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: false }));
    }
  }

  async function loadMemo(quoteId: string, force = false) {
    if (!quoteId) return;
    if (!force && memoByQuoteId[quoteId]) return;
    setMemoLoadingByQuoteId((prev) => ({ ...prev, [quoteId]: true }));
    setMemoErrorByQuoteId((prev) => ({ ...prev, [quoteId]: "" }));
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/pricing/quote/${quoteId}/memo-block`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok || !json?.ok || !json?.md) {
        throw new Error(json?.error ?? "Memo not available yet.");
      }
      setMemoByQuoteId((prev) => ({ ...prev, [quoteId]: json.md }));
    } catch (err: any) {
      setMemoErrorByQuoteId((prev) => ({
        ...prev,
        [quoteId]: err?.message ?? "Memo not available yet.",
      }));
    } finally {
      setMemoLoadingByQuoteId((prev) => ({ ...prev, [quoteId]: false }));
    }
  }

  useEffect(() => {
    if (!activeQuoteId) return;
    if (tab === "memo") {
      void loadMemo(activeQuoteId);
    }
    if (tab === "explain") {
      void loadExplainability(activeQuoteId);
    }
  }, [activeQuoteId, tab]);

  async function handleExplain(quoteId: string) {
    if (expandedQuoteId === quoteId) {
      setExpandedQuoteId(null);
      return;
    }
    setExpandedQuoteId(quoteId);
    if (explainByQuoteId[quoteId]) return;

    setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: true }));
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/pricing/quote/${quoteId}/explain`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to load explainability");
      }
      setExplainByQuoteId((prev) => ({ ...prev, [quoteId]: json.explain }));
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Explain failed" });
    } finally {
      setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: false }));
    }
  }

  async function handleLock(quoteId: string) {
    if (!confirm("Locking freezes this quote for committee. Continue?")) return;
    setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: true }));
    setStatus(null);
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/pricing/quote/${quoteId}/lock`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to lock quote");
      }
      await refreshQuotes();
      setStatus({ kind: "success", message: "Quote locked for committee." });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Lock failed" });
    } finally {
      setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: false }));
    }
  }

  async function handleCopyMemo(quoteId: string) {
    setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: true }));
    setStatus(null);
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/pricing/quote/${quoteId}/memo-block`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok || !json?.ok || !json?.md) {
        throw new Error(json?.error ?? "Failed to fetch memo block");
      }
      await navigator.clipboard.writeText(json.md);
      setMemoByQuoteId((prev) => ({ ...prev, [quoteId]: json.md }));
      setMemoErrorByQuoteId((prev) => ({ ...prev, [quoteId]: "" }));
      setStatus({ kind: "success", message: "Pricing memo copied." });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Copy failed" });
    } finally {
      setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: false }));
    }
  }

  async function insertPricingIntoCreditMemo(quoteId: string) {
    setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: true }));
    setStatus(null);
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/credit-memo/pricing/insert`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quote_id: quoteId }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Insert failed");
      }
      if (json?.inserted) {
        setStatus({ kind: "success", message: "Inserted into credit memo." });
        return;
      }

      if (json?.md) {
        await navigator.clipboard.writeText(json.md);
        setMemoByQuoteId((prev) => ({ ...prev, [quoteId]: json.md }));
        setMemoErrorByQuoteId((prev) => ({ ...prev, [quoteId]: "" }));
        setStatus({ kind: "success", message: "Copied for paste." });
        return;
      }

      const fallback = await fetch(
        `/api/deals/${deal.id}/pricing/quote/${quoteId}/memo-block`,
        { cache: "no-store" },
      );
      const fbJson = await fallback.json();
      if (!fallback.ok || !fbJson?.ok || !fbJson?.md) {
        throw new Error(fbJson?.error ?? "Failed to build memo block");
      }
      await navigator.clipboard.writeText(fbJson.md);
      setMemoByQuoteId((prev) => ({ ...prev, [quoteId]: fbJson.md }));
      setMemoErrorByQuoteId((prev) => ({ ...prev, [quoteId]: "" }));
      setStatus({ kind: "success", message: "Copied for paste." });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Insert failed" });
    } finally {
      setBusyByQuoteId((prev) => ({ ...prev, [quoteId]: false }));
    }
  }

  async function handleCopy(quote: QuoteRow) {
    const summary = `${deal.borrower_name ?? deal.id} • ${quote.index_code} ${formatPct(quote.base_rate_pct)}% + ${quote.spread_bps} bps = ${formatPct(quote.all_in_rate_pct)}% • ${money(quote.loan_amount)} • ${quote.term_months}m/${quote.amort_months}m`;
    try {
      await navigator.clipboard.writeText(summary);
      setStatus({ kind: "success", message: "Quote summary copied." });
    } catch {
      setStatus({ kind: "error", message: "Copy failed." });
    }
  }

  const activeQuote =
    (activeQuoteId && quoteHistory.find((q) => q.id === activeQuoteId)) ||
    quoteHistory[0] ||
    null;
  const activeMemo = activeQuote?.id ? memoByQuoteId[activeQuote.id] : "";
  const memoLoading = activeQuote?.id
    ? memoLoadingByQuoteId[activeQuote.id]
    : false;
  const memoError = activeQuote?.id ? memoErrorByQuoteId[activeQuote.id] : "";

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
            </div>

            <button
              className="mt-4 text-sm text-slate-600 underline"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? "Hide advanced" : "Show advanced"}
            </button>

            {showAdvanced ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
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

                <Field label="Notes">
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    type="text"
                    value={form.notes ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        notes: e.target.value || null,
                      }))
                    }
                    placeholder="Optional"
                  />
                </Field>
              </div>
            ) : null}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Stat
                label="Base Rate"
                value={`${formatPct(baseRatePct)}%`}
                hint={rateAsOf ? `as of ${rateAsOf}` : ""}
              />
              <Stat label="Spread" value={fmtBps(spreadBps)} />
              <Stat label="All-In Rate" value={`${formatPct(allInRatePct)}%`} emphasize />
            </div>

            <div className="mt-2 text-xs text-slate-500">
              Live source: {rateSource ?? "—"}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save inputs"}
              </button>
              <button
                className="rounded border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={handleRefreshRates}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing..." : "Refresh live rates"}
              </button>
              <button
                className="rounded border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={handleQuote}
                disabled={quoting}
              >
                {quoting ? "Quoting..." : "Generate bank-grade quote"}
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

            {lastSnapshot ? (
              <div className="mt-4 rounded border bg-slate-50 p-3 text-xs text-slate-700">
                <div className="font-semibold">Latest bank-grade snapshot</div>
                <div className="mt-1">
                  Snapshot ID: <span className="font-mono">{lastSnapshot.id}</span>
                </div>
                <div>
                  As of: {lastSnapshot.as_of_date} · Source: {lastSnapshot.source}
                </div>
                <div>
                  {lastSnapshot.index_label} @ {formatPct(lastSnapshot.index_rate_pct)}%
                </div>
              </div>
            ) : null}
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
            <div className="text-3xl font-bold">{pricing?.risk.score ?? "—"}</div>
            <div className="text-sm text-slate-600 mt-1">
              Tier: {pricing?.risk.tier ?? "—"} · Decision:{" "}
              <span className={pricing?.decision === "approve" ? "text-green-700 font-medium" : "text-amber-700 font-medium"}>
                {pricing?.decision?.toUpperCase() ?? "—"}
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

        <section className="grid grid-cols-1 gap-4">
          <Card title="Quote History">
            {quoteHistory.length === 0 ? (
              <p className="text-sm text-slate-600">No quotes yet.</p>
            ) : (
              <div className="space-y-3">
                {quoteHistory.map((quote) => {
                  const isLocked = quote.status === "locked";
                  const isExpanded = expandedQuoteId === quote.id;
                  const explain = explainByQuoteId[quote.id];
                  const memoCached = !!memoByQuoteId[quote.id];
                  const busy = !!busyByQuoteId[quote.id];
                  const isActive = activeQuoteId === quote.id;

                  return (
                    <div
                      key={quote.id}
                      className={`rounded border p-3 ${isActive ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveQuoteId(quote.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setActiveQuoteId(quote.id);
                        }
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold flex flex-wrap items-center gap-2">
                            <span>
                              {formatDateTime(quote.created_at)} · {quote.index_code}
                            </span>
                            {isLocked ? (
                              <span className="inline-flex items-center rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                                LOCKED
                              </span>
                            ) : null}
                            {isActive ? (
                              <span className="inline-flex items-center rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                ACTIVE
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-slate-500">
                            Base {formatPct(quote.base_rate_pct)}% · Spread {quote.spread_bps} bps · All-in {formatPct(quote.all_in_rate_pct)}%
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExplain(quote.id);
                            }}
                            disabled={busy}
                          >
                            {isExpanded ? "Hide explain" : "Explain"}
                          </button>
                          {!isLocked ? (
                            <button
                              className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleLock(quote.id);
                              }}
                              disabled={busy}
                            >
                              Lock quote
                            </button>
                          ) : null}
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyMemo(quote.id);
                            }}
                            disabled={busy}
                          >
                            {memoCached ? "Copy pricing memo (cached)" : "Copy pricing memo"}
                          </button>
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              insertPricingIntoCreditMemo(quote.id);
                            }}
                            disabled={busy}
                          >
                            Insert into credit memo
                          </button>
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(quote);
                            }}
                          >
                            Copy quote summary
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-slate-600">
                        Amount {money(quote.loan_amount)} · Term {quote.term_months}m · Amort {quote.amort_months}m · IO {quote.interest_only_months}m
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        P&I {quote.monthly_payment_pi != null ? money(quote.monthly_payment_pi) : "—"}
                        {quote.monthly_payment_io != null ? ` · IO ${money(quote.monthly_payment_io)}` : ""}
                      </div>

                      {isLocked ? (
                        <div className="mt-2 text-xs text-slate-500">
                          Locked{quote.locked_at ? ` on ${formatDateTime(quote.locked_at)}` : ""}
                          {quote.lock_reason ? ` · ${quote.lock_reason}` : ""}
                        </div>
                      ) : null}

                      {quote.rate_index_snapshots ? (
                        <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">
                          Snapshot {quote.rate_index_snapshots.id} · {quote.rate_index_snapshots.index_label} @ {formatPct(quote.rate_index_snapshots.index_rate_pct)}%
                          <div>
                            As of {quote.rate_index_snapshots.as_of_date} · Source {quote.rate_index_snapshots.source}
                          </div>
                        </div>
                      ) : null}
                      {(quote.pricing_policy_id || quote.pricing_policy_version || quote.pricing_model_hash) ? (
                        <div className="mt-2 text-xs text-slate-500">
                          Policy {quote.pricing_policy_id ?? "—"} · Version {quote.pricing_policy_version ?? "—"} · Hash {quote.pricing_model_hash ?? "—"}
                        </div>
                      ) : null}

                      {isExpanded ? (
                        <div className="mt-3 rounded border bg-slate-50 p-3 text-xs text-slate-700">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold">Explainability</div>
                            <div className="text-slate-500">
                              Confidence {explain ? `${Math.round(explain.confidence * 100)}%` : "—"}
                            </div>
                          </div>
                          {explain ? (
                            <>
                              <div className="mt-2">{explain.summary}</div>
                              <div className="mt-3">
                                <div className="font-semibold text-slate-700">Drivers</div>
                                <div className="mt-1 space-y-1">
                                  {explain.drivers?.map((d, i) => (
                                    <div key={i} className="flex items-start justify-between gap-2">
                                      <div className="text-slate-700">
                                        {d.label}
                                        {d.reason ? ` — ${d.reason}` : ""}
                                      </div>
                                      <div className="font-mono text-slate-600">{fmtBps(d.bps)}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {explain.missingInputs?.length ? (
                                <div className="mt-3">
                                  <div className="font-semibold text-slate-700">Missing inputs</div>
                                  <ul className="mt-1 list-disc pl-4 text-slate-600">
                                    {explain.missingInputs.map((m, i) => (
                                      <li key={i}>
                                        {m.label}
                                        {m.impactBps != null ? ` (impact ~${m.impactBps} bps)` : ""}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : (
                                <div className="mt-3 text-slate-500">No missing inputs flagged.</div>
                              )}
                            </>
                          ) : (
                            <div className="mt-2 text-slate-500">Explainability not available yet.</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4">
          <Card title="Quote Detail">
            {quoteHistory.length === 0 || !activeQuote ? (
              <p className="text-sm text-slate-600">
                Create a quote to view memo preview.
              </p>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2 border-b">
                  <button
                    className={
                      tab === "quote"
                        ? "rounded-t border border-b-0 bg-white px-3 py-2 text-sm font-medium"
                        : "rounded-t px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
                    }
                    onClick={() => setTab("quote")}
                  >
                    Quote
                  </button>
                  <button
                    className={
                      tab === "explain"
                        ? "rounded-t border border-b-0 bg-white px-3 py-2 text-sm font-medium"
                        : "rounded-t px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
                    }
                    onClick={() => setTab("explain")}
                  >
                    Explainability
                  </button>
                  <button
                    className={
                      tab === "memo"
                        ? "rounded-t border border-b-0 bg-white px-3 py-2 text-sm font-medium"
                        : "rounded-t px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
                    }
                    onClick={() => setTab("memo")}
                  >
                    Memo Preview
                  </button>
                </div>

                <div className="rounded-b border border-t-0 p-4">
                  {tab === "quote" ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-slate-700">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Rate</div>
                        <div className="mt-1 font-semibold">
                          {formatPct(activeQuote.all_in_rate_pct)}% all-in
                        </div>
                        <div className="text-xs text-slate-500">
                          Base {formatPct(activeQuote.base_rate_pct)}% · Spread {activeQuote.spread_bps} bps
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Terms</div>
                        <div className="mt-1 font-semibold">
                          {money(activeQuote.loan_amount)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {activeQuote.term_months}m term · {activeQuote.amort_months}m amort · {activeQuote.interest_only_months}m IO
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Payments</div>
                        <div className="mt-1 font-semibold">
                          {activeQuote.monthly_payment_pi != null
                            ? money(activeQuote.monthly_payment_pi)
                            : "—"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {activeQuote.monthly_payment_io != null
                            ? `IO ${money(activeQuote.monthly_payment_io)}`
                            : "IO —"}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {tab === "explain" ? (
                    <div className="text-sm text-slate-700">
                      {!explainByQuoteId[activeQuote.id] ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-slate-500">
                            Explainability not loaded yet.
                          </div>
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => loadExplainability(activeQuote.id)}
                            disabled={!!busyByQuoteId[activeQuote.id]}
                          >
                            {busyByQuoteId[activeQuote.id] ? "Loading..." : "Load explainability"}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold">Summary</div>
                            <div className="text-xs text-slate-500">
                              Confidence {Math.round(explainByQuoteId[activeQuote.id].confidence * 100)}%
                            </div>
                          </div>
                          <div>{explainByQuoteId[activeQuote.id].summary}</div>
                          <div>
                            <div className="font-semibold">Drivers</div>
                            <div className="mt-2 space-y-1">
                              {explainByQuoteId[activeQuote.id].drivers.map((d, i) => (
                                <div key={i} className="flex items-start justify-between gap-2">
                                  <div>
                                    {d.label}
                                    {d.reason ? ` — ${d.reason}` : ""}
                                  </div>
                                  <div className="font-mono text-slate-600">{fmtBps(d.bps)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                          {explainByQuoteId[activeQuote.id].missingInputs.length ? (
                            <div>
                              <div className="font-semibold">Missing inputs</div>
                              <ul className="mt-1 list-disc pl-4 text-slate-600">
                                {explainByQuoteId[activeQuote.id].missingInputs.map((m, i) => (
                                  <li key={i}>
                                    {m.label}
                                    {m.impactBps != null ? ` (impact ~${m.impactBps} bps)` : ""}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <div className="text-slate-500">No missing inputs flagged.</div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {tab === "memo" ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold">Memo Preview</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => handleCopyMemo(activeQuote.id)}
                            disabled={!!busyByQuoteId[activeQuote.id]}
                          >
                            Copy memo
                          </button>
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                            onClick={() =>
                              window.open(
                                `/api/deals/${deal.id}/pricing/quote/${activeQuote.id}/memo-pdf`,
                                "_blank",
                              )
                            }
                            disabled={!activeQuote?.id}
                          >
                            Download PDF Appendix
                          </button>
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => insertPricingIntoCreditMemo(activeQuote.id)}
                            disabled={!!busyByQuoteId[activeQuote.id]}
                          >
                            Insert into credit memo
                          </button>
                        </div>
                      </div>
                      {activeQuote.status !== "locked" ? (
                        <div className="text-xs text-slate-500">
                          Locking this quote will freeze the memo for committee.
                        </div>
                      ) : null}

                      {memoLoading ? (
                        <div className="text-sm text-slate-500">Loading memo...</div>
                      ) : memoError ? (
                        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
                          <span>{memoError}</span>
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-slate-50"
                            onClick={() => loadMemo(activeQuote.id, true)}
                          >
                            Retry
                          </button>
                        </div>
                      ) : activeMemo ? (
                        <SafeMarkdown markdown={activeMemo} />
                      ) : (
                        <div className="text-sm text-slate-500">
                          Memo not available yet.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
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
              {(pricing?.explain ?? []).map((x, i) => (
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
  if (!Number.isFinite(rate)) return "0.000";
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

function normalizeInputs(deal: Deal, inputs: PricingInputs | null, loanRequestAmount?: number | null): PricingInputs {
  const base: PricingInputs = {
    index_code: "SOFR",
    index_tenor: null,
    base_rate_override_pct: null,
    spread_override_bps: null,
    loan_amount: loanRequestAmount ?? null,
    term_months: 120,
    amort_months: 300,
    interest_only_months: 0,
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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
