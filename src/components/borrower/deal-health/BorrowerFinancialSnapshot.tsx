"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerFinancialSnapshot as SnapshotType } from "@/lib/borrower/buildBorrowerDealHealthViewModel";

export function BorrowerFinancialSnapshot({
  snapshot,
}: {
  snapshot: SnapshotType;
}) {
  if (!snapshot.available) {
    return (
      <section className="rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50/60 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-100">
            <Icon name="pending" className="h-4 w-4 text-stone-400" />
          </div>
          <h3 className="text-sm font-semibold text-stone-600">
            Financial Snapshot
          </h3>
        </div>
        <p className="mt-3 text-sm text-stone-500">
          {snapshot.summary}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-100">
          <Icon name="analytics" className="h-4 w-4 text-teal-700" />
        </div>
        <h3 className="text-sm font-semibold text-stone-900">
          Financial Snapshot
        </h3>
      </div>
      <p className="mt-2 text-sm text-stone-600">
        {snapshot.summary}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {snapshot.receivedStatementTypes &&
          snapshot.receivedStatementTypes.length > 0 && (
            <div className="rounded-xl border border-stone-100 bg-stone-50/50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                Statements Received
              </div>
              <ul className="mt-2 space-y-1">
                {snapshot.receivedStatementTypes.map((type) => (
                  <li key={type} className="flex items-center gap-1.5">
                    <Icon
                      name="check_circle"
                      className="h-3 w-3 text-emerald-500"
                    />
                    <span className="text-xs text-stone-700">{type}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

        {snapshot.periodsCovered && snapshot.periodsCovered.length > 0 && (
          <div className="rounded-xl border border-stone-100 bg-stone-50/50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              Periods Covered
            </div>
            <ul className="mt-2 space-y-1">
              {snapshot.periodsCovered.map((period) => (
                <li key={period} className="flex items-center gap-1.5">
                  <Icon name="event" className="h-3 w-3 text-sky-500" />
                  <span className="text-xs text-stone-700">{period}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {snapshot.extractedFields && snapshot.extractedFields.length > 0 && (
          <div className="rounded-xl border border-stone-100 bg-stone-50/50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              Data Fields Identified
            </div>
            <ul className="mt-2 space-y-1">
              {snapshot.extractedFields.map((field) => (
                <li key={field} className="flex items-center gap-1.5">
                  <Icon
                    name="auto_awesome"
                    className="h-3 w-3 text-amber-500"
                  />
                  <span className="text-xs text-stone-700">{field}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
