const ITEMS = [
  {
    q: "What does it cost?",
    a: "$1,000 packaging fee paid from loan proceeds at closing — never out of pocket. Lenders pay 1% of the funded loan. Both fees disclosed on SBA Form 159.",
  },
  {
    q: "How long does it take?",
    a: "Typical 30–60 days from start to funded. The marketplace step itself is about 2 business days — preview, claim, pick.",
  },
  {
    q: "What documents do I need?",
    a: "Your last 3 years of business tax returns, last 3 months of bank statements, a government ID, and your business formation documents. Buddy guides you through exactly what's needed.",
  },
  {
    q: "Is my data safe?",
    a: "Yes. Your identity is hidden from all matched lenders during preview and claim. Only the lender you pick ever sees your name.",
  },
  {
    q: "What if I don't like any of the claims?",
    a: "You can veto and re-list once for free within 60 days. No obligation, no pressure.",
  },
];

export function BrokerageFAQ() {
  return (
    <section className="bg-white text-slate-900">
      <div className="max-w-4xl mx-auto px-4 py-20">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-widest text-blue-600 mb-3">
            Common questions
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Things borrowers actually ask.
          </h2>
        </header>
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {ITEMS.map((it, i) => (
            <details key={i} className="group py-5">
              <summary className="flex items-center justify-between cursor-pointer list-none">
                <span className="text-base font-medium text-slate-900">
                  {it.q}
                </span>
                <span className="ml-4 text-slate-400 group-open:rotate-45 transition-transform">
                  +
                </span>
              </summary>
              <p className="mt-3 text-slate-600 text-sm leading-relaxed">
                {it.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
