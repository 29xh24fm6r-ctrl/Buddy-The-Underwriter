import Link from "next/link";

export const dynamic = "force-dynamic";

export default function BorrowerNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 bg-white">
      <h1 className="text-2xl font-semibold text-slate-900">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-3 text-slate-600">
        The link may have moved, or the session may have ended. Your information
        is safe.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          className="rounded-xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          href="/start"
        >
          Start a new application
        </Link>
        <Link
          className="rounded-xl border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50"
          href="/"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
