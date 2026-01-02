export function HowItWorks3Steps() {
  return (
    <section className="bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <h3 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">How it works</h3>
        <p className="mt-3 max-w-2xl text-sm text-white/65 md:text-base">
          Three steps. Zero training. The system does the remembering.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { t: "Upload", d: "Send documents from banker, borrower, or link." },
            { t: "Converge", d: "Buddy finalizes evidence and reconciles requirements automatically." },
            { t: "Move forward", d: "When it's ready, the next stage unlocks — instantly." },
          ].map((s) => (
            <div key={s.t} className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-base font-medium text-white">{s.t}</div>
              <div className="mt-2 text-sm text-white/65">{s.d}</div>
              <div className="mt-6 h-px bg-white/10" />
              <div className="mt-4 text-xs text-white/50">Calm, convergent, explainable.</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
