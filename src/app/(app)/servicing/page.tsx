import Link from "next/link";
import { listDealsForBank } from "@/lib/deals/listDeals";
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

export const dynamic = "force-dynamic";

export default async function Page() {
  const deals = await listDealsForBank(100);

  return (
    <GlassShell>
      <GlassPageHeader
        title="Servicing Command Center"
        subtitle="Active loans and compliance checks"
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
            icon="assignment"
            title="No servicing deals"
            description="No servicing deals found for this bank."
          />
        ) : (
          <GlassTable>
            <GlassTableHeader>
              <GlassTableHeaderCell>Deal</GlassTableHeaderCell>
              <GlassTableHeaderCell>Borrower</GlassTableHeaderCell>
              <GlassTableHeaderCell>Stage</GlassTableHeaderCell>
              <GlassTableHeaderCell align="right">Actions</GlassTableHeaderCell>
            </GlassTableHeader>
            <GlassTableBody>
              {deals.map((deal) => (
                <GlassTableRow key={deal.id}>
                  <GlassTableCell>
                    <span className="font-medium text-white">
                      {deal.name || "Untitled Deal"}
                    </span>
                  </GlassTableCell>
                  <GlassTableCell>{deal.borrower}</GlassTableCell>
                  <GlassTableCell>{deal.stageLabel}</GlassTableCell>
                  <GlassTableCell align="right">
                    <Link
                      href={`/deals/${deal.id}/command`}
                      className="text-primary hover:text-primary/80 text-sm font-semibold"
                    >
                      Review Deal
                    </Link>
                  </GlassTableCell>
                </GlassTableRow>
              ))}
            </GlassTableBody>
          </GlassTable>
        )}
      </GlassPanel>
    </GlassShell>
  );
}
