import Link from "next/link";

export default function DealsPage() {
  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Deals</h1>
          <Link
            href="/deals/new"
            className="rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
          >
            New Deal
          </Link>
        </header>

        <div className="rounded-xl border bg-white p-6 text-gray-600">
          No deals yet. Create your first underwriting file.
        </div>
      </div>
    </main>
  );
}
