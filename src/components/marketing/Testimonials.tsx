const TESTIMONIALS = [
  {
    quote: "Buddy cut our SBA underwriting time from 3 weeks to 3 days.",
    author: "Sarah Chen",
    title: "VP of Lending, Community Bank"
  },
  {
    quote: "The event audit trail saved us during our last SBA examination.",
    author: "Michael Rodriguez",
    title: "Chief Credit Officer"
  },
  {
    quote: "Our borrowers actually enjoy the process now. That's never happened before.",
    author: "Jennifer Kim",
    title: "Relationship Manager"
  }
];

export function Testimonials() {
  return (
    <section className="py-20 px-6 bg-white">
      <h2 className="text-3xl font-bold text-center mb-12">
        Loved by Lenders
      </h2>
      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {TESTIMONIALS.map(t => (
          <div key={t.author} className="border border-gray-200 p-6 rounded-lg">
            <p className="text-gray-700 mb-4 italic">&ldquo;{t.quote}&rdquo;</p>
            <div>
              <p className="font-semibold">{t.author}</p>
              <p className="text-sm text-gray-600">{t.title}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
