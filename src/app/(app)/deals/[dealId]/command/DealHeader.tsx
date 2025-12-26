"use client";

import type { DealContext } from "@/lib/deals/contextTypes";

export function DealHeader({ context }: { context: DealContext }) {
  const stageBadgeColor = {
    intake: "bg-blue-100 text-blue-800",
    review: "bg-yellow-100 text-yellow-800",
    committee: "bg-purple-100 text-purple-800",
    approved: "bg-green-100 text-green-800",
    declined: "bg-red-100 text-red-800",
  }[context.stage];

  return (
    <div className="border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {context.borrower.name}
          </h1>
          <p className="text-sm text-gray-500">{context.borrower.entityType}</p>
        </div>

        <div className="flex items-center gap-4">
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${stageBadgeColor}`}>
            {context.stage.toUpperCase()}
          </span>

          {context.risk.score > 0 && (
            <div className="text-right">
              <div className="text-sm font-medium text-gray-700">
                Risk Score
              </div>
              <div className="text-xl font-bold text-gray-900">
                {context.risk.score}
              </div>
            </div>
          )}
        </div>
      </div>

      {context.risk.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {context.risk.flags.map((flag, i) => (
            <span
              key={i}
              className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
            >
              {flag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
