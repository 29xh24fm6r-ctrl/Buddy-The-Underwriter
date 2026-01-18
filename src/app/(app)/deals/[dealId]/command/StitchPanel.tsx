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
          This view can’t be embedded here (browser blocks framed pages). Open it in a new tab.
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            href={`/underwrite/${dealId}`}
            target="_blank"
            rel="noreferrer"
          >
            Open Underwriting
          </a>
          <a
            className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            href={`/deals/${dealId}/cockpit`}
          >
            Back to Cockpit
          </a>
        </div>
      </div>
      <div className="sr-only">
        {context.borrower?.name ? `Deal: ${context.borrower.name}` : "Deal context loaded"}
      </div>
    </div>
  );
}
