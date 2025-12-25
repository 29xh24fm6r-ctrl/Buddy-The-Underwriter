import { getDealContext } from "@/lib/deals/getDealContext";
import { CommandHeader } from "./_components/CommandHeader";
import { StatGrid } from "./_components/StatGrid";
import { IntelPanel } from "./_components/IntelPanel";
import { DocsPanel } from "./_components/DocsPanel";
import { TimelinePanel } from "./_components/TimelinePanel";
import { PricingPanel } from "./_components/PricingPanel";
import { RawContextPanel } from "./_components/RawContextPanel";

export const runtime = "nodejs";

export default async function DealCommandCenterPage({ params }: { params: { dealId: string } }) {
  const ctx = await getDealContext(params.dealId);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <CommandHeader dealId={params.dealId} ctx={ctx} />

      <div className="mt-6">
        <StatGrid ctx={ctx} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <IntelPanel dealId={params.dealId} ctx={ctx} />
          <PricingPanel dealId={params.dealId} ctx={ctx} />
          <DocsPanel dealId={params.dealId} ctx={ctx} />
        </div>

        <div className="space-y-4">
          <TimelinePanel ctx={ctx} />
          <RawContextPanel ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
