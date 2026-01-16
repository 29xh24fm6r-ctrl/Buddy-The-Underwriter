"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DealFinancialSnapshotPanel } from "@/components/committee/DealFinancialSnapshotPanel";

export type CreditCommitteeDealRow = {
  id: string;
  name: string;
  borrower: string;
  stageLabel: string;
};

export function CreditCommitteeClient({ deals }: { deals: CreditCommitteeDealRow[] }) {
  const [selectedDealId, setSelectedDealId] = useState<string | null>(deals[0]?.id ?? null);

  const selected = useMemo(() => deals.find((d) => d.id === selectedDealId) ?? null, [deals, selectedDealId]);

  return (
    <main className="p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_520px]">
        <div className="bg-[#181b21] border border-white/10 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[#1f242d] border-b border-white/10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">Deal</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">Borrower</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">Stage</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {deals.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-white/50">
                    No deals found.
                  </td>
                </tr>
              )}
              {deals.map((deal) => {
                const active = deal.id === selectedDealId;
                return (
                  <tr
                    key={deal.id}
                    className={["transition-colors", active ? "bg-white/10" : "hover:bg-white/5"].join(" ")}
                  >
                    <td className="px-6 py-4 text-white font-medium">{deal.name || "Untitled Deal"}</td>
                    <td className="px-6 py-4 text-white/70">{deal.borrower}</td>
                    <td className="px-6 py-4 text-white/70">{deal.stageLabel}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          className="text-white/80 hover:text-white text-sm font-semibold"
                          onClick={() => setSelectedDealId(deal.id)}
                        >
                          Snapshot
                        </button>
                        <Link
                          href={`/deals/${deal.id}/command`}
                          className="text-primary hover:text-primary/80 text-sm font-semibold"
                        >
                          Review Deal
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="lg:sticky lg:top-6 h-fit">
          {selected ? (
            <div className="rounded-lg border border-white/10 bg-[#0f1115] p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Selected deal</div>
              <div className="mt-1 text-base font-semibold text-white">{selected.name || "Untitled Deal"}</div>
              <div className="text-sm text-white/60">{selected.borrower}</div>
            </div>
          ) : null}

          {selectedDealId ? (
            <div className="mt-4">
              <DealFinancialSnapshotPanel dealId={selectedDealId} />
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-white/10 bg-[#111418] p-4 text-white/60">Select a deal to view snapshot.</div>
          )}
        </div>
      </div>
    </main>
  );
}
