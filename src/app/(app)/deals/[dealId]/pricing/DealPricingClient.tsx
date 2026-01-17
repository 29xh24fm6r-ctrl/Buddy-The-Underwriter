"use client";

import Link from "next/link";
import type React from "react";

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

export default function DealPricingClient({
  deal,
  pricing,
}: {
  deal: Deal;
  pricing: Pricing;
}) {

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

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="Quoted Rate">
            <div className="text-3xl font-bold">{pricing.quote.apr.toFixed(3)}%</div>
            <div className="text-sm text-slate-600 mt-1">
              Spread: {pricing.quote.spreadBps} bps · Base: {pricing.quote.baseRate.toFixed(3)}%
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

          <Card title="Max Loan (Model)">
            <div className="text-3xl font-bold">
              {pricing.quote.maxLoanAmount != null ? money(pricing.quote.maxLoanAmount) : "—"}
            </div>
            <div className="text-sm text-slate-600 mt-1">
              (Derived from NOI/DSCR/constraints)
            </div>
          </Card>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Inputs Used">
            <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto">
              {JSON.stringify(pricing.inputs, null, 2)}
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

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtBps(bps: number) {
  const sign = bps > 0 ? "+" : "";
  return `${sign}${bps} bps`;
}
