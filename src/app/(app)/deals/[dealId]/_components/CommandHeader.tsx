"use client";

import Link from "next/link";

export function CommandHeader({ dealId, ctx }: { dealId: string; ctx: any }) {
  const bankName = ctx?.bank?.name ?? ctx?.bank?.legal_name ?? "—";
  const dealName =
    ctx?.borrower?.name ??
    ctx?.name ??
    ctx?.deal_name ??
    ctx?.title ??
    `Deal ${dealId.slice(0, 8)}`;
  const updatedAt = ctx?._meta?.updated_at ? new Date(ctx._meta.updated_at).toLocaleString() : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm text-white/60">Deal Command Center</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-white">{dealName}</div>
          <div className="mt-1 text-sm text-white/70">
            Bank: <span className="text-white">{bankName}</span>
            {updatedAt ? <span className="ml-3 text-white/50">Snapshot: {updatedAt}</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15"
            href={`/deals/${dealId}#intel`}
          >
            Intel
          </Link>
          <Link
            className="rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15"
            href={`/deals/${dealId}#pricing`}
          >
            Pricing
          </Link>
          <Link
            className="rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15"
            href={`/deals/${dealId}#docs`}
          >
            Documents
          </Link>
          <button
            onClick={async () => {
              await fetch(`/api/deals/${dealId}/intel/run`, { method: "POST" });
              window.location.reload();
            }}
            className="rounded-full bg-emerald-500/20 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/25"
            title="Runs intel on the most recent upload for this deal"
          >
            Run Intel Now
          </button>
        </div>
      </div>
    </div>
  );
}
