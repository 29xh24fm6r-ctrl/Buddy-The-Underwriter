import Link from "next/link";

export function BrokerageHero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent" />
      <div className="relative max-w-6xl mx-auto px-4 py-24 sm:py-32 text-center">
        <p className="text-xs uppercase tracking-widest text-blue-300 mb-5">
          SBA loans, without the runaround
        </p>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-6">
          Get a real SBA loan,
          <br className="hidden sm:block" /> on your terms.
        </h1>
        <p className="text-lg sm:text-xl text-slate-300 max-w-3xl mx-auto mb-10">
          Buddy prepares your complete institutional-grade lender package. Up to
          3 matched lenders claim your deal. You pick. We&apos;re paid the same
          no matter who wins — that&apos;s the point.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/start"
            className="inline-flex items-center justify-center px-7 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
          >
            Start your package
          </Link>
          <a
            href="#how-it-works"
            className="inline-flex items-center justify-center px-7 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white font-semibold transition-colors border border-white/10"
          >
            How it works
          </a>
        </div>
      </div>
    </section>
  );
}
