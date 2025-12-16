import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50 p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            Buddy The Underwriter
          </h1>
          <p className="text-gray-600">
            Upload documents. Extract truth. Stress reality. Produce
            committee-ready credit decisions.
          </p>
        </header>

        <div className="flex gap-4">
          <Link
            href="/deals"
            className="rounded-lg bg-black px-5 py-3 text-white hover:opacity-90"
          >
            Open Deals
          </Link>
          <Link
            href="/deals/new"
            className="rounded-lg border border-gray-300 px-5 py-3 hover:bg-white"
          >
            New Deal
          </Link>
        </div>

        <section className="rounded-xl border bg-white p-6">
          <h2 className="text-lg font-semibold">Prime Directive</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
            <li>Buddy does not guess.</li>
            <li>Every number is traceable.</li>
            <li>Failure modes come first.</li>
            <li>Survivability beats optimism.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
