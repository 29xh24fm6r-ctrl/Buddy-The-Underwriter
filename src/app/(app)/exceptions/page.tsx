import Link from "next/link";
import { listDealsForBank } from "@/lib/deals/listDeals";

export const dynamic = "force-dynamic";

export default async function Page() {
  const deals = await listDealsForBank(100);

  return (
    <div className="min-h-screen bg-[#0f1115] text-white">
      <header className="border-b border-white/10 bg-[#111418] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Exceptions</h1>
            <p className="text-sm text-white/60 mt-1">Exceptions queue and remediation</p>
          </div>
          <Link href="/deals" className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors">
            View Deals
          </Link>
        </div>
      </header>

      <main className="p-6">
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
                  <td colSpan={4} className="px-6 py-10 text-center text-white/50">No deals found.</td>
                </tr>
              )}
              {deals.map((deal) => (
                <tr key={deal.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">{deal.name || "Untitled Deal"}</td>
                  <td className="px-6 py-4 text-white/70">{deal.borrower}</td>
                  <td className="px-6 py-4 text-white/70">{deal.stageLabel}</td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/deals/${deal.id}/command`} className="text-primary hover:text-primary/80 text-sm font-semibold">
                      Review Deal
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
