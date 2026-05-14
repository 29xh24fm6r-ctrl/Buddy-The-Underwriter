"use client";

import Link from "next/link";

const STEPS = [
  { n: 1, title: "Tell Buddy about your business", desc: "Answer questions about your business, financials, and loan needs. Buddy's AI concierge guides you." },
  { n: 2, title: "Upload your documents", desc: "Tax returns, financials, and supporting docs. Buddy extracts and organizes everything." },
  { n: 3, title: "Buddy builds your package", desc: "Business plan, projections, feasibility study, SBA forms — prepared and reviewed for completeness." },
  { n: 4, title: "Lenders review and compete", desc: "Qualified SBA lenders see your anonymized profile and submit claims through the marketplace." },
  { n: 5, title: "You choose your lender", desc: "Compare offers and pick the lender that fits. Your identity stays private until you decide." },
  { n: 6, title: "Buddy coordinates closing", desc: "Conditions tracking, document collection, and funding verification — all the way to funded." },
];

export function BrokerageLandingPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          Buddy Brokerage
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
          Get your SBA loan package built and matched to the right lender.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600">
          Buddy prepares your complete SBA loan application, scores your deal,
          and connects you with qualified lenders through a competitive
          marketplace. You pick the lender. We coordinate closing.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/apply"
            className="inline-flex rounded-full bg-neutral-900 px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-neutral-800"
          >
            Start your SBA package
          </Link>
          <Link
            href="/start"
            className="inline-flex rounded-full border border-neutral-300 px-8 py-3.5 text-sm font-semibold text-neutral-700 transition hover:border-neutral-500"
          >
            Talk to Buddy
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-neutral-50 py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-2xl font-bold text-neutral-900">
            How it works
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">
                  {s.n}
                </div>
                <h3 className="mt-4 text-sm font-semibold text-neutral-900">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm text-neutral-600">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fee disclosure */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl bg-neutral-50 px-8 py-6">
          <h3 className="text-sm font-semibold text-neutral-900">
            Fee disclosure
          </h3>
          <p className="mt-3 text-sm text-neutral-600">
            A packaging fee of <strong>$1,000</strong> applies for SBA loan
            preparation and lender matching services. This fee may be financed
            into the loan at closing, subject to lender approval. Buddy may also
            receive a referral fee from the selected lender, disclosed on SBA
            Form 159.
          </p>
          <p className="mt-3 text-xs text-neutral-400">
            Buddy does not guarantee loan approval. SBA loan approval is subject
            to lender underwriting, SBA guidelines, and borrower eligibility.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-neutral-900 py-16 text-center">
        <h2 className="text-2xl font-bold text-white">
          Ready to get started?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-neutral-400">
          Buddy builds your complete SBA package and matches you with the right
          lender. Start in minutes.
        </p>
        <Link
          href="/apply"
          className="mt-8 inline-flex rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-100"
        >
          Start your SBA package
        </Link>
      </section>

      {/* Bank platform entry — secondary */}
      <section className="border-t border-neutral-200 bg-white py-12" data-section="bank-platform-entry">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h3 className="text-sm font-semibold text-neutral-500">
            For banks and SBA lenders
          </h3>
          <p className="mt-3 text-sm text-neutral-600">
            Looking for <strong>Buddy The Underwriter</strong>, our bank-facing
            underwriting intelligence platform?
          </p>
          <Link
            href="/underwriter"
            className="mt-5 inline-flex rounded-full border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-600 transition hover:border-neutral-500 hover:text-neutral-900"
          >
            Explore the banking platform
          </Link>
        </div>
      </section>
    </main>
  );
}
