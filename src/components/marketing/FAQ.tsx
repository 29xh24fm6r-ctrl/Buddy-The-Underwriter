const faqs = [
  {
    q: "Is Buddy just an SBA platform?",
    a: "No. Buddy is a Loan Operations System for commercial lending. SBA is one workflow it can support — not the category.",
  },
  {
    q: "Do we need to train our team?",
    a: "No. The UI is truth-first and self-explanatory. Deals converge to readiness automatically.",
  },
  {
    q: "What happens if a document arrives late?",
    a: "The system self-heals. Checklist and readiness reconcile automatically when evidence finalizes.",
  },
  {
    q: "How do we know what's blocking a deal?",
    a: "Readiness always includes a reason, and the ledger provides a precise stage/status timeline.",
  },
];

export function FAQ() {
  return (
    <section className="bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <h3 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">FAQ</h3>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {faqs.map((f) => (
            <div key={f.q} className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-base font-medium text-white">{f.q}</div>
              <div className="mt-2 text-sm text-white/65">{f.a}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
