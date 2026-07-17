import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NotFound() {
  // This is the app-wide fallback for any unmatched route (including
  // dead-ended borrower URLs under /start and elsewhere — see
  // (borrower)/start/not-found.tsx, which Next.js's App Router never
  // actually renders for structurally unmatched paths). The root layout
  // doesn't set a page-level background, so the previous white/10 + white/70
  // styling — designed for a dark surface — rendered near-invisible on the
  // default white background. This page now supplies its own dark
  // background so it reads correctly regardless of which route it's
  // reached from.
  return (
    <div className="min-h-dvh bg-slate-950 text-white">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mt-3 text-white/70">That route doesn't exist (or it moved).</p>
        <div className="mt-8">
          <Link className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/15" href="/">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
