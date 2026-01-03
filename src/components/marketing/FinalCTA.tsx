export function FinalCTA() {
  return (
    <section id="request-access" className="relative bg-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900" />
        <div className="absolute -bottom-20 left-1/2 h-80 w-[44rem] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-10 backdrop-blur md:p-14">
          <h3 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Stop managing deals.
            <br />
            Let them converge.
          </h3>
          <p className="mt-4 max-w-2xl text-sm text-white/65 md:text-base">
            Buddy replaces workflows with convergence — and makes readiness obvious.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#"
              className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-slate-900 shadow-[0_20px_60px_rgba(255,255,255,0.12)]"
            >
              Request access
            </a>
            <a
              href="#see-it-converge"
              className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white backdrop-blur hover:bg-white/10"
            >
              See it converge
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
