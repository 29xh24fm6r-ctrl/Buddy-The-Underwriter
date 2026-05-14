"use client";

import Link from "next/link";

export function BrandSplitPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
            Buddy
          </h1>
          <p className="mt-4 text-lg text-neutral-600">
            Two products. One mission: make SBA lending work.
          </p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-2">
          {/* Brokerage Card */}
          <Link
            href="/brokerage"
            className="group rounded-3xl border-2 border-neutral-200 bg-white p-8 shadow-sm transition hover:border-neutral-900 hover:shadow-md"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              For Business Owners
            </div>
            <h2 className="mt-3 text-2xl font-bold text-neutral-900">
              Buddy Brokerage
            </h2>
            <p className="mt-3 text-sm leading-6 text-neutral-600">
              Get your SBA loan package built by AI and matched to qualified lenders
              through a competitive marketplace. You pick the lender. We coordinate
              closing.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-neutral-700">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-600">&#10003;</span>
                AI-powered loan packaging
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-600">&#10003;</span>
                Lender marketplace matching
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-600">&#10003;</span>
                Closing coordination
              </li>
            </ul>
            <div className="mt-8 inline-flex rounded-full bg-neutral-900 px-6 py-3 text-sm font-semibold text-white transition group-hover:bg-neutral-800">
              I need an SBA loan &rarr;
            </div>
          </Link>

          {/* Underwriter Card */}
          <Link
            href="/underwriter"
            className="group rounded-3xl border-2 border-neutral-200 bg-white p-8 shadow-sm transition hover:border-neutral-900 hover:shadow-md"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
              For Banks &amp; Lenders
            </div>
            <h2 className="mt-3 text-2xl font-bold text-neutral-900">
              Buddy The Underwriter
            </h2>
            <p className="mt-3 text-sm leading-6 text-neutral-600">
              AI-native commercial underwriting intelligence for SBA lenders.
              Document extraction, credit analysis, policy-aware memos, and
              approval tracking — built for your credit team.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-neutral-700">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-blue-600">&#10003;</span>
                Document intelligence &amp; extraction
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-blue-600">&#10003;</span>
                Credit memo generation
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-blue-600">&#10003;</span>
                Policy-aware underwriting
              </li>
            </ul>
            <div className="mt-8 inline-flex rounded-full bg-neutral-900 px-6 py-3 text-sm font-semibold text-white transition group-hover:bg-neutral-800">
              I evaluate SBA loans &rarr;
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
