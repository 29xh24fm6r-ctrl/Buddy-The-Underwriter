import Link from "next/link";
import { listDealsForBank } from "@/lib/deals/listDeals";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getCanonicalMemoStatusForDeals } from "@/lib/creditMemo/canonical/getCanonicalMemoStatusForDeals";
import ExportCanonicalMemoPdfButton from "@/components/creditMemo/ExportCanonicalMemoPdfButton";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
  GlassTable,
  GlassTableHeader,
  GlassTableHeaderCell,
  GlassTableBody,
  GlassTableRow,
  GlassTableCell,
  GlassEmptyState,
} from "@/components/layout";

export default async function CreditMemoHome() {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const deals = await listDealsForBank(100);
  const bankId = await getCurrentBankId();
  const statusByDeal = await getCanonicalMemoStatusForDeals({
    bankId,
    dealIds: deals.map((d) => d.id),
  });

  return (
    <GlassShell>
      <GlassPageHeader
        title="Credit Memo"
        subtitle="Generate pricing + memo outputs for each deal"
        actions={
          <Link
            href="/deals"
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors"
          >
            View Deals
          </Link>
        }
      />

      <GlassPanel>
        {deals.length === 0 ? (
          <GlassEmptyState
            icon="description"
            title="No deals found"
            description="Create a deal to generate credit memos."
          />
        ) : (
          <GlassTable>
            <GlassTableHeader>
              <GlassTableHeaderCell>Deal</GlassTableHeaderCell>
              <GlassTableHeaderCell>Borrower</GlassTableHeaderCell>
              <GlassTableHeaderCell>Stage</GlassTableHeaderCell>
              <GlassTableHeaderCell>Canonical</GlassTableHeaderCell>
              <GlassTableHeaderCell align="right">Actions</GlassTableHeaderCell>
            </GlassTableHeader>
            <GlassTableBody>
              {deals.map((deal) => {
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
                  <GlassTableRow key={deal.id}>
                    <GlassTableCell>
                      <span className="font-medium text-white">
                        {deal.name || "Untitled Deal"}
                      </span>
                    </GlassTableCell>
                    <GlassTableCell>{deal.borrower}</GlassTableCell>
                    <GlassTableCell>{deal.stageLabel}</GlassTableCell>
                    <GlassTableCell>
                      <div className="flex flex-col gap-1">
                        <span
                          className={[
                            "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
                            badge,
                          ].join(" ")}
                        >
                          {st?.status ?? "pending"}
                        </span>
                        <div className="text-[11px] text-white/50">
                          Last data: {st?.last_generated_at ?? "—"}
                        </div>
                      </div>
                    </GlassTableCell>
                    <GlassTableCell align="right">
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
                    </GlassTableCell>
                  </GlassTableRow>
                );
              })}
            </GlassTableBody>
          </GlassTable>
        )}
      </GlassPanel>
    </GlassShell>
  );
}
