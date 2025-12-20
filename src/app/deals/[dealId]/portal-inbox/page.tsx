"use client";

import * as React from "react";
import { PortalChatCard } from "@/components/deals/PortalChatCard";
import { MissingItemsCard } from "@/components/deals/MissingItemsCard";
import { PortalStatusCard } from "@/components/deals/PortalStatusCard";
import { PortalReceiptsCard } from "@/components/deals/PortalReceiptsCard";

export default function PortalInboxPage({ params }: any) {
  const [unwrappedParams, setUnwrappedParams] = React.useState<{ dealId: string } | null>(null);

  React.useEffect(() => {
    Promise.resolve(params).then(setUnwrappedParams);
  }, [params]);

  if (!unwrappedParams) {
    return <div className="p-6 text-sm text-gray-600">Loading…</div>;
  }

  const dealId = unwrappedParams.dealId;
  const bankerUserId = "demo-banker"; // TODO: Get from auth context

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-4 rounded-2xl border bg-white p-5">
        <div className="text-lg font-semibold">Borrower Portal Inbox</div>
        <div className="mt-1 text-sm text-gray-600">
          Real-time view of borrower portal activity — chat, checklist, receipts, status
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-4">
          <PortalChatCard dealId={dealId} bankerUserId={bankerUserId} />
          <PortalStatusCard dealId={dealId} bankerUserId={bankerUserId} />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <MissingItemsCard dealId={dealId} bankerUserId={bankerUserId} />
          <PortalReceiptsCard dealId={dealId} bankerUserId={bankerUserId} />
        </div>
      </div>
    </div>
  );
}
