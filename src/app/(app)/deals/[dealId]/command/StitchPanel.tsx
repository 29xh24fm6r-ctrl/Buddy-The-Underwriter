"use client";

import type { DealContext } from "@/lib/deals/contextTypes";

export function StitchPanel({
  dealId,
  context,
}: {
  dealId: string;
  context: DealContext;
}) {
  return (
    <div className="h-full p-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-lg font-semibold text-gray-900">Command</div>
        <div className="mt-2 text-sm text-gray-600">
          This view can’t be embedded here (browser blocks framed pages). Use the action above to open underwriting in a new tab.
        </div>
      </div>
      <div className="sr-only">
        {context.borrower?.name ? `Deal: ${context.borrower.name}` : "Deal context loaded"}
      </div>
    </div>
  );
}
