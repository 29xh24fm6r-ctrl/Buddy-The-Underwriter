const FEATURES = [
  {
    title: "One-Click E-Tran Readiness",
    desc: "From borrower intake to SBA-ready packages without chaos."
  },
  {
    title: "Event-Sourced Audit Trail",
    desc: "Every decision explained, replayable, and examiner-safe."
  },
  {
    title: "Borrower Delight",
    desc: "Your borrowers finally understand what's happening."
  },
  {
    title: "Multi-Bank Offers",
    desc: "Compare SBA 7(a) and conventional offers side-by-side."
  },
  {
    title: "Policy-as-Code",
    desc: "Bank-specific overlays and SBA SOP citations automatically enforced."
  },
  {
    title: "AI Copilot",
    desc: "Borrower chat, document intelligence, and underwriting assistance."
  }
];

export function Features() {
  return (
    <section className="py-20 px-6 bg-white">
      <h2 className="text-3xl font-bold text-center mb-12">
        Everything You Need to Underwrite Faster
      </h2>
      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {FEATURES.map(f => (
          <div key={f.title} className="border border-gray-200 p-6 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
            <p className="text-gray-600">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
