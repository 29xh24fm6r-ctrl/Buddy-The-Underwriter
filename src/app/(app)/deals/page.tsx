import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { derivePipelineStatus } from "@/lib/deals/derivePipeline";
import Link from "next/link";

function formatMoney(amount: unknown): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

type DealRow = {
  id: string;
  borrower_name?: string | null;
  name?: string | null;
  amount?: number | string | null;
  stage?: string | null;
  created_at?: string | null;
  ready_at?: string | null;
  submitted_at?: string | null;
  ready_reason?: string | null;
};

export default async function DealsPage() {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const selectPrimary = "id, borrower_name, name, amount, stage, created_at, ready_at, submitted_at, ready_reason";
  const selectFallback = "id, borrower_name, name, created_at";

  let deals: DealRow[] = [];
  {
    const res = await sb
      .from("deals")
      .select(selectPrimary)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!res.error) {
      deals = (res.data ?? []) as DealRow[];
    } else {
      const msg = String(res.error.message || "");
      const schemaMaybeMissing = msg.includes("column") || msg.includes("does not exist");

      if (!schemaMaybeMissing) {
        console.error("[/deals] deals_select_failed:", res.error);
      }

      const fallbackRes = await sb
        .from("deals")
        .select(selectFallback)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (fallbackRes.error) {
        console.error("[/deals] deals_select_fallback_failed:", fallbackRes.error);
        deals = [];
      } else {
        deals = (fallbackRes.data ?? []) as DealRow[];
      }
    }
  }

  const uiDeals = deals.map((d) => {
    const createdAt = d.created_at ? new Date(d.created_at) : null;
    const createdLabel = createdAt
      ? createdAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
        })
      : "-";

    const borrower = d.borrower_name || d.name || "Untitled deal";
    const amountLabel = d.amount != null ? formatMoney(d.amount) : "-";

    const stage = d.stage ? String(d.stage) : "-";

    // If the schema supports these columns, show a human pipeline status. Otherwise, keep it blank.
    let status: string | null = null;
    if ("submitted_at" in d || "ready_at" in d) {
      try {
        status = derivePipelineStatus(d as any);
      } catch {
        status = null;
      }
    }

    return {
      id: d.id,
      borrower,
      amountLabel,
      stage,
      status,
      createdLabel,
    };
  });

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
                  Created
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {uiDeals.map((deal) => (
                <tr key={deal.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-white">
                    {deal.borrower}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.amountLabel}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.stage}
                  </td>
                  <td className="px-6 py-4">
                    {deal.status ? (
                      <span
                        className={
                          "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/5 text-white/80 border border-white/10"
                        }
                      >
                        {deal.status}
                      </span>
                    ) : (
                      <span className="text-xs text-white/40">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/80">
                    {deal.createdLabel}
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

        {uiDeals.length === 0 && (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-white/20 text-6xl">folder_open</span>
            <p className="text-white/60 mt-4">No deals yet. Create your first deal to get started.</p>
          </div>
        )}
      </main>
    </div>
  );
}
