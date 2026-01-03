const outcomes = [
  { t: "Deals don't stall", d: "Blockers are visible immediately." },
  { t: "No training required", d: "It's obvious what's missing." },
  { t: "Always explainable", d: "Every state has a reason." },
  { t: "Race-proof by design", d: "Uploads can't outrun readiness." },
  { t: "Borrower + banker unified", d: "All evidence lands in one truth." },
  { t: "Operational clarity", d: "Timeline tells the story." },
];

export function OutcomesGrid() {
  return (
    <section className="bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <h3 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">What you get</h3>
        <p className="mt-3 max-w-2xl text-sm text-white/65 md:text-base">
          Not more features. Less work. More certainty.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {outcomes.map((o) => (
            <div key={o.t} className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-base font-medium text-white">{o.t}</div>
              <div className="mt-2 text-sm text-white/65">{o.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
