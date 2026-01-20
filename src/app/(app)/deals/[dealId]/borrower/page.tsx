import { clerkAuth } from "@/lib/auth/clerkServer";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ dealId?: string }>;
}) {
  const { userId } = await clerkAuth();
  const { dealId } = await params;

  if (!userId) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Borrower</h1>
        <p className="mt-2 text-sm text-white/70">Please sign in to continue.</p>
      </div>
    );
  }

  if (!dealId || dealId === "undefined") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Borrower</h1>
        <p className="mt-2 text-sm text-white/70">Loading deal…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] p-6">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Banker View</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Borrower Portal (Borrower-facing)</h1>
        <p className="mt-2 text-sm text-slate-600">
          The borrower portal is reserved for borrowers. Use the deal cockpit to attach borrowers,
          send portal links, and manage uploads.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/deals/${dealId}/cockpit`}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Go to Deal Cockpit
          </Link>
          <Link
            href={`/deals/${dealId}/cockpit?anchor=borrower-attach`}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Attach Borrower
          </Link>
        </div>
      </div>
    </div>
  );
}
