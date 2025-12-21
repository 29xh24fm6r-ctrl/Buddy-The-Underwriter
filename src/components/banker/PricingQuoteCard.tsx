"use client";

import * as React from "react";
import { EvidenceChips } from "@/components/evidence/EvidenceChips";

export function PricingQuoteCard(props: { dealId: string }) {
  const [productType, setProductType] = React.useState("SBA_7A");
  const [riskGrade, setRiskGrade] = React.useState("6");
  const [termMonths, setTermMonths] = React.useState(120);
  const [indexName, setIndexName] = React.useState("SOFR");
  const [indexRateBps, setIndexRateBps] = React.useState(525); // 5.25%
  const [quote, setQuote] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setError(null);
    setQuote(null);
    try {
      const res = await fetch(`/api/banker/deals/${props.dealId}/pricing/quote`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "banker", // replace with your auth header pattern
        },
        body: JSON.stringify({ productType, riskGrade, termMonths, indexName, indexRateBps }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Quote failed");
      setQuote(json.quote);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    }
  }

  function bpsToPct(bps: number) {
    return (bps / 100).toFixed(2) + "%";
  }

  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Risk-based pricing</div>
          <div className="mt-1 text-sm text-gray-600">Banker-only. Audited. Deterministic policy + overrides.</div>
        </div>

        <EvidenceChips
          dealId={props.dealId}
          scope="pricing"
          action="quote"
          label="Why this pricing?"
          limit={10}
        />
      </div>

      {error ? <div className="mt-3 text-sm text-red-700">{error}</div> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <Field label="Product" value={productType} onChange={setProductType} />
        <Field label="Risk grade" value={riskGrade} onChange={setRiskGrade} />
        <NumField label="Term (months)" value={termMonths} onChange={setTermMonths} />
        <Field label="Index" value={indexName} onChange={setIndexName} />
        <NumField label="Index (bps)" value={indexRateBps} onChange={setIndexRateBps} />
      </div>

      <div className="mt-4">
        <button className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50" onClick={run}>
          Compute quote
        </button>
      </div>

      {quote ? (
        <div className="mt-4 rounded-xl border bg-gray-50 p-4">
          <div className="text-sm font-semibold">Final rate</div>
          <div className="mt-1 text-lg font-semibold">{bpsToPct(Number(quote.final_rate_bps))}</div>
          <div className="mt-2 text-xs text-gray-600">Base spread: {quote.base_spread_bps} bps • Override: {quote.override_spread_bps} bps</div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">Explain</summary>
            <pre className="mt-2 overflow-auto rounded-lg border bg-white p-3 text-xs">{JSON.stringify(quote.explain, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-gray-600">
      {props.label}
      <input className="mt-1 h-10 w-full rounded-md border px-3 text-sm" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function NumField(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-xs text-gray-600">
      {props.label}
      <input
        type="number"
        className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
