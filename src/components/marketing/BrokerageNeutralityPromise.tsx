const PROMISES = [
  {
    title: "We never pick a lender. You always pick.",
    body: "Buddy presents whichever claims came in. 0, 1, 2, or 3. You choose. We never shop your deal off-platform.",
  },
  {
    title: "Rates come from a published rate card.",
    body: "No haggling, no hidden markups. The rate for your loan is pegged to SBA-published parameters and your deal's strength band. Every claimant offers the same rate.",
  },
  {
    title: "Your identity is hidden until you pick.",
    body: "Lenders see your package strength, not your name. Only the picked lender ever sees who you are.",
  },
  {
    title: "We&apos;re paid the same fee regardless of which lender wins.",
    body: "That&apos;s why we can stay neutral. Our incentive is funded deals, not favored lenders.",
  },
];

export function BrokerageNeutralityPromise() {
  return (
    <section className="bg-slate-50 text-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-20">
        <header className="max-w-3xl mb-12">
          <p className="text-xs uppercase tracking-widest text-blue-600 mb-3">
            Neutrality promise
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Neutral by design, not by promise.
          </h2>
        </header>
        <div className="grid md:grid-cols-2 gap-6">
          {PROMISES.map((p, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-6"
            >
              <h3
                className="text-lg font-semibold mb-2"
                dangerouslySetInnerHTML={{ __html: p.title }}
              />
              <p
                className="text-slate-600 text-sm"
                dangerouslySetInnerHTML={{ __html: p.body }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
