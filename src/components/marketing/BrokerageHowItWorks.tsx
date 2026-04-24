const STEPS = [
  {
    n: "1",
    title: "Talk to Buddy, upload a few documents.",
    body: "Answer in plain English. Buddy builds your full package — business plan, projections, feasibility study, SBA forms.",
  },
  {
    n: "2",
    title: "Your package hits the Buddy Marketplace.",
    body: "Matched lenders preview for 24 hours, then up to 3 can claim your deal during a same-day claim window.",
  },
  {
    n: "3",
    title: "You review the claims and pick.",
    body: "See full lender identity, closing timeline, and any relationship terms. Pick one. Your full trident releases to you and your package releases to the lender you picked.",
  },
];

export function BrokerageHowItWorks() {
  return (
    <section id="how-it-works" className="bg-white text-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-20">
        <header className="max-w-3xl mb-12">
          <p className="text-xs uppercase tracking-widest text-blue-600 mb-3">
            How it works
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Three steps, about 30–60 days from start to funded.
          </h2>
        </header>
        <div className="grid md:grid-cols-3 gap-6">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-6"
            >
              <div className="text-blue-600 text-sm font-semibold tracking-widest mb-2">
                STEP {s.n}
              </div>
              <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
              <p className="text-slate-600 text-sm">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
