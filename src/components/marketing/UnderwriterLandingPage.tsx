"use client";

import Link from "next/link";

const CAPABILITIES = [
  { n: 1, title: "Intake documents", desc: "Upload tax returns, financials, rent rolls, PFS — Buddy extracts structured data from any format." },
  { n: 2, title: "Extract and reconcile facts", desc: "AI-powered extraction with deterministic validation. No hallucinated numbers. Every fact traced to source." },
  { n: 3, title: "Generate underwriting analysis", desc: "DSCR, global cash flow, stress testing, SBA eligibility — computed from verified facts, not guesses." },
  { n: 4, title: "Produce credit memo", desc: "Institutional-grade credit memo with narrative, risk assessment, and policy overlay — ready for committee." },
  { n: 5, title: "Track through closing", desc: "Conditions, approvals, document collection, and funding verification — managed in one place." },
];

export function UnderwriterLandingPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
          Buddy The Underwriter
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
          AI-native underwriting intelligence for SBA lenders.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600">
          Document extraction, financial spreading, credit memo generation, and
          policy-aware analysis — built for commercial credit teams who need
          speed without sacrificing rigor.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/sign-up"
            className="inline-flex rounded-full bg-neutral-900 px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-neutral-800"
          >
            Request lender demo
          </Link>
          <Link
            href="/for-banks"
            className="inline-flex rounded-full border border-neutral-300 px-8 py-3.5 text-sm font-semibold text-neutral-700 transition hover:border-neutral-500"
          >
            View platform overview
          </Link>
        </div>
      </section>

      {/* Capabilities */}
      <section className="bg-neutral-50 py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-2xl font-bold text-neutral-900">
            What Buddy does for your credit team
          </h2>
          <div className="mt-12 space-y-6">
            {CAPABILITIES.map((c) => (
              <div
                key={c.n}
                className="flex gap-5 rounded-2xl bg-white p-6 shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">
                  {c.n}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">
                    {c.title}
                  </h3>
                  <p className="mt-1 text-sm text-neutral-600">{c.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-2xl border border-neutral-200 p-6">
            <h3 className="text-sm font-semibold text-neutral-900">
              Deterministic extraction
            </h3>
            <p className="mt-2 text-sm text-neutral-600">
              Every number traces to a source document. No LLM hallucination in
              the facts layer — AI assists, deterministic code decides.
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 p-6">
            <h3 className="text-sm font-semibold text-neutral-900">
              Policy-aware analysis
            </h3>
            <p className="mt-2 text-sm text-neutral-600">
              SBA SOP 50 10 rules, bank-specific policy overlays, and product
              thresholds — all enforced before the memo reaches committee.
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 p-6">
            <h3 className="text-sm font-semibold text-neutral-900">
              Audit-ready output
            </h3>
            <p className="mt-2 text-sm text-neutral-600">
              Full provenance chain from source document to credit decision.
              Built for examiner review and regulatory compliance.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-neutral-900 py-16 text-center">
        <h2 className="text-2xl font-bold text-white">
          See Buddy in action on your deals.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-neutral-400">
          Request a demo with your own loan files. See extraction, spreading,
          and credit memo generation on a real deal.
        </p>
        <Link
          href="/sign-up"
          className="mt-8 inline-flex rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-100"
        >
          Request demo
        </Link>
      </section>

      {/* Borrower cross-nav — secondary */}
      <section className="border-t border-neutral-200 bg-white py-12" data-section="borrower-cross-nav">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-sm text-neutral-500">
            Business owner seeking SBA financing?{" "}
            <Link
              href="/brokerage"
              className="font-medium text-neutral-700 underline transition hover:text-neutral-900"
            >
              Visit BuddySBA.com
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
