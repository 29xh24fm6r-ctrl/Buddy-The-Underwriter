import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import Link from "next/link";

export default async function DealsPage() {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  // TODO: Fetch actual deals from database
  const deals = [
    {
      id: "1",
      borrower: "Highland Capital Group",
      amount: "$2.5M",
      status: "In Progress",
      stage: "Underwriting",
      daysOpen: 12,
    },
    {
      id: "2", 
      borrower: "Riverstone Properties LLC",
      amount: "$1.8M",
      status: "Pending Docs",
      stage: "Intake",
      daysOpen: 5,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0f1115]">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#111418] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Deals Pipeline</h1>
            <p className="text-sm text-white/60 mt-1">Manage your loan pipeline</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="search"
              placeholder="Search deals..."
              className="px-4 py-2 bg-[#1f242d] border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Link
              href="/deals/new"
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined inline-block mr-2 align-middle text-[20px]">add</span>
              New Deal
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        <div className="bg-[#181b21] border border-white/10 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[#1f242d] border-b border-white/10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Borrower
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Stage
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Days Open
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {deals.map((deal) => (
                <tr key={deal.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-white">
                    {deal.borrower}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.amount}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.stage}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      deal.status === "In Progress" 
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                    }`}>
                      {deal.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.daysOpen} days
                  </td>
                  <td className="px-6 py-4 text-right text-sm">
                    <Link
                      href={`/deals/${deal.id}/cockpit`}
                      className="text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1"
                    >
                      View
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {deals.length === 0 && (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-white/20 text-6xl">folder_open</span>
            <p className="text-white/60 mt-4">No deals yet. Create your first deal to get started.</p>
          </div>
        )}
      </main>
    </div>
  );
}
