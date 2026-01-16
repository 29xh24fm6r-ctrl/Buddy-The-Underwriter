import Link from "next/link";
import { listDealsForBank } from "@/lib/deals/listDeals";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getCanonicalMemoStatusForDeals } from "@/lib/creditMemo/canonical/getCanonicalMemoStatusForDeals";
import ExportCanonicalMemoPdfButton from "@/components/creditMemo/ExportCanonicalMemoPdfButton";

export default async function CreditMemoHome() {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const deals = await listDealsForBank(100);
  const bankId = await getCurrentBankId();
  const statusByDeal = await getCanonicalMemoStatusForDeals({
    bankId,
    dealIds: deals.map((d) => d.id),
  });

  return (
    <div className="min-h-screen bg-[#0f1115] text-white">
      <header className="border-b border-white/10 bg-[#111418] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Credit Memo</h1>
            <p className="text-sm text-white/60 mt-1">Generate pricing + memo outputs for each deal</p>
          </div>
          <Link
            href="/deals"
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors"
          >
            View Deals
          </Link>
        </div>
      </header>

      <main className="p-6">
        <div className="bg-[#181b21] border border-white/10 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[#1f242d] border-b border-white/10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Deal
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Borrower
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Stage
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Canonical
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {deals.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-white/50">
                    No deals found.
                  </td>
                </tr>
              )}
              {deals.map((deal) => (
                (() => {
                  const st = statusByDeal[deal.id];
                  const badge =
                    st?.status === "ready"
                      ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30"
                      : st?.status === "partial"
                        ? "bg-amber-600/20 text-amber-200 border-amber-500/30"
                        : st?.status === "error"
                          ? "bg-rose-600/20 text-rose-200 border-rose-500/30"
                          : "bg-white/5 text-white/70 border-white/10";

                  return (
                <tr key={deal.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">
                    {deal.name || "Untitled Deal"}
                  </td>
                  <td className="px-6 py-4 text-white/70">{deal.borrower}</td>
                  <td className="px-6 py-4 text-white/70">{deal.stageLabel}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className={["inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", badge].join(" ")}
                      >
                        {st?.status ?? "pending"}
                      </span>
                      <div className="text-[11px] text-white/50">
                        Last data: {st?.last_generated_at ?? "—"}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/credit-memo/${deal.id}/canonical`}
                        className="inline-flex items-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90"
                      >
                        Canonical Credit Memo
                      </Link>
                      <ExportCanonicalMemoPdfButton
                        dealId={deal.id}
                        className="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
                        label="Export PDF"
                      />
                      <Link
                        href={`/deals/${deal.id}/pricing-memo`}
                        className="inline-flex items-center rounded-lg border border-white/15 bg-white/0 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/5 hover:text-white"
                      >
                        Memo Center
                      </Link>
                    </div>
                  </td>
                </tr>
                  );
                })()
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
