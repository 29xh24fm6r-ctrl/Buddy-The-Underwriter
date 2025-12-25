import Link from "next/link";

export default function CreditMemoHome() {
  return (
    <div className="min-h-screen bg-bg-dark text-white">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Credit Memo</h1>
        <p className="mt-2 text-white/70">
          Choose a deal to generate or continue a memo. (We’ll wire this to real deal selection next.)
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/deals/highland-apts-refi/memos/new"
            className="rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition"
          >
            <div className="text-sm text-white/60">Demo</div>
            <div className="mt-1 text-lg font-medium">Highland Apts Refi</div>
            <div className="mt-2 text-sm text-white/70">Start / continue memo →</div>
          </Link>

          <Link
            href="/deals"
            className="rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition"
          >
            <div className="text-sm text-white/60">Browse</div>
            <div className="mt-1 text-lg font-medium">Go to Deals</div>
            <div className="mt-2 text-sm text-white/70">Pick a deal from pipeline →</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
