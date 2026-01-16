import Link from "next/link";
import { listDealsForBank } from "@/lib/deals/listDeals";
import { CreditCommitteeClient } from "@/components/committee/CreditCommitteeClient";

export const dynamic = "force-dynamic";

export default async function CreditCommitteePage() {
  const deals = await listDealsForBank(100);
  const rows = deals.map((d) => ({
    id: d.id,
    name: d.name ?? "Untitled Deal",
    borrower: d.borrower,
    stageLabel: d.stageLabel,
  }));

  return (
    <div className="min-h-screen bg-[#0f1115] text-white">
      <header className="border-b border-white/10 bg-[#111418] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Credit Committee</h1>
            <p className="text-sm text-white/60 mt-1">Active decisions and voting queue</p>
          </div>
          <Link href="/committee" className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors">
            Committee Center
          </Link>
        </div>
      </header>

      <CreditCommitteeClient deals={rows} />
    </div>
  );
}
