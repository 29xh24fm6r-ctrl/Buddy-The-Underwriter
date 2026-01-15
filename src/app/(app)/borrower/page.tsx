import Link from "next/link";
import { listDealsForBank } from "@/lib/deals/listDeals";

export const dynamic = "force-dynamic";

export default async function BorrowerPage() {
  const deals = await listDealsForBank(200);

  const borrowers = new Map();
  for (const deal of deals) {
    const name = deal.borrower || "Unknown Borrower";
    const entry = borrowers.get(name);
    if (entry) {
      entry.dealCount += 1;
    } else {
      borrowers.set(name, { name, dealId: deal.id, dealCount: 1 });
    }
  }

  const list = Array.from(borrowers.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-[#0f1115] text-white">
      <header className="border-b border-white/10 bg-[#111418] px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">Borrower Directory</h1>
          <p className="text-sm text-white/60 mt-1">Borrowers with active deals</p>
        </div>
      </header>

      <main className="p-6">
        <div className="bg-[#181b21] border border-white/10 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[#1f242d] border-b border-white/10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">Borrower</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">Deals</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {list.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-10 text-center text-white/50">No borrowers found.</td>
                </tr>
              )}
              {list.map((borrower) => (
                <tr key={borrower.name} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">{borrower.name}</td>
                  <td className="px-6 py-4 text-white/70">{borrower.dealCount}</td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/deals/${borrower.dealId}`} className="text-primary hover:text-primary/80 text-sm font-semibold">
                      View Deal
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
