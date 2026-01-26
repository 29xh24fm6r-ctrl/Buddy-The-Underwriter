"use client";

import useSWR from "swr";
import { Icon } from "@/components/ui/Icon";

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  return res.json();
};

export default function MatchedLendersPanel({ dealId }: { dealId: string }) {
  const { data, error, isLoading } = useSWR(`/api/deals/${dealId}/lenders/match`, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
        <div className="text-sm text-neutral-600">Loading matched lenders…</div>
      </div>
    );
  }

  if (error || (data && !data.ok)) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon name="handshake" className="h-5 w-5 text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-500">Matched Lenders</h3>
        </div>
        <div className="text-sm text-neutral-500">Not available yet</div>
        <div className="text-xs text-neutral-400 mt-1">We'll match lenders after financial snapshot and terms are set.</div>
      </div>
    );
  }

  const matches = data?.matches?.matched ?? [];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="handshake" className="h-5 w-5 text-neutral-900" />
        <h3 className="text-sm font-semibold">Matched Lenders</h3>
      </div>
      {matches.length === 0 ? (
        <div>
          <div className="text-sm text-neutral-500">No lender match yet</div>
          <div className="text-xs text-neutral-400 mt-1">We'll match lenders after financial snapshot and terms are set.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {matches.slice(0, 5).map((m: any, idx: number) => (
            <div key={`${m.lender}-${idx}`} className="rounded-lg border border-neutral-200 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-neutral-900">{m.lender}</div>
                <div className="text-xs text-neutral-500">Fit {m.fitScore}</div>
              </div>
              {m.program ? <div className="text-xs text-neutral-500">{m.program}</div> : null}
              {Array.isArray(m.reasons) && m.reasons.length ? (
                <div className="text-xs text-neutral-500 mt-1">{m.reasons.join(" ")}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
