import Link from "next/link";

export function BrokerageFinalCTA() {
  return (
    <section className="bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
          Ready to start?
        </h2>
        <p className="text-lg text-slate-300 mb-8">
          Tell Buddy a little about your business and your financing need.
          Everything else — package, marketplace, pick — follows from there.
        </p>
        <Link
          href="/start"
          className="inline-flex items-center justify-center px-8 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
        >
          Start your package
        </Link>
      </div>
    </section>
  );
}
