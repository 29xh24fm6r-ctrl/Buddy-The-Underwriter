import Link from "next/link";

export default async function DealWorkspace({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }> | { dealId: string };
  searchParams?: Promise<Record<string, string>> | Record<string, string>;
}) {
  const p = params instanceof Promise ? await params : params;
  const sp = searchParams instanceof Promise ? await searchParams : searchParams;

  const dealName = sp?.name ?? "Untitled Deal";

  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-2">
          <Link href="/deals" className="text-sm text-gray-600 hover:underline">
            ← Back to Deals
          </Link>
          <h1 className="text-3xl font-bold">{dealName}</h1>
          <p className="text-sm text-gray-500 font-mono">
            Deal ID: {p.dealId}
          </p>
        </header>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-xl border bg-white p-6">
            <h2 className="text-lg font-semibold">Document Uploads</h2>
            <p className="text-sm text-gray-600 mt-1">
              Upload tax returns, PFS, financials, leases.
            </p>

            <div className="mt-4 rounded-lg border border-dashed p-6 text-sm text-gray-500">
              Upload UI coming next.
            </div>
          </div>

          <div className="rounded-xl border bg-white p-6">
            <h2 className="text-lg font-semibold">Extraction Results</h2>
            <p className="text-sm text-gray-600 mt-1">
              OCR output, confidence, and QC flags.
            </p>

            <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
              No results yet.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
