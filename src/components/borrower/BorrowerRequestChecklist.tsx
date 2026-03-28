"use client";

/**
 * Phase 65F — Borrower Request Checklist
 *
 * Shows outstanding + completed request items in plain English.
 * No internal blocker codes or underwriting terminology.
 */

import type { BorrowerItemStatus } from "@/core/borrower-orchestration/types";

type ChecklistItem = {
  id: string;
  title: string;
  description: string;
  status: BorrowerItemStatus;
  required: boolean;
  completedAt: string | null;
};

const STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",    // ○
  sent: "\u25CB",       // ○
  viewed: "\u25CB",     // ○
  uploaded: "\u25D2",   // ◒
  submitted: "\u25D2",  // ◒
  confirmed: "\u25D2",  // ◒
  completed: "\u25CF",  // ●
  waived: "\u25CF",     // ●
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Not started",
  sent: "Requested",
  viewed: "Viewed",
  uploaded: "Uploaded",
  submitted: "Submitted",
  confirmed: "Confirmed",
  completed: "Complete",
  waived: "Not needed",
};

export function BorrowerRequestChecklist({
  items,
  onItemClick,
}: {
  items: ChecklistItem[];
  onItemClick?: (itemId: string) => void;
}) {
  if (items.length === 0) return null;

  const pending = items.filter((i) => i.status !== "completed" && i.status !== "waived");
  const done = items.filter((i) => i.status === "completed" || i.status === "waived");

  return (
    <div data-testid="borrower-request-checklist" className="space-y-4">
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-neutral-800 mb-2">
            What we need from you
          </h3>
          <ul className="space-y-2">
            {pending.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3 cursor-pointer hover:bg-neutral-50"
                onClick={() => onItemClick?.(item.id)}
              >
                <span className="mt-0.5 text-neutral-400">
                  {STATUS_ICONS[item.status] ?? STATUS_ICONS.pending}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-neutral-800">
                    {item.title}
                    {item.required && (
                      <span className="ml-1 text-[10px] text-red-500 font-bold uppercase">
                        Required
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {item.description}
                  </div>
                  <div className="text-[10px] text-neutral-400 mt-1">
                    {STATUS_LABELS[item.status] ?? "Pending"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-neutral-600 mb-2">
            Completed
          </h3>
          <ul className="space-y-1">
            {done.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg p-2 text-neutral-500"
              >
                <span className="text-green-500">{STATUS_ICONS.completed}</span>
                <span className="text-sm line-through">{item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
