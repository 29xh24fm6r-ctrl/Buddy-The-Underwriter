"use client";

import { BorrowerChecklistEmptyState } from "@/components/borrower/BorrowerChecklistEmptyState";
import { BorrowerChecklistItem } from "@/components/borrower/BorrowerChecklistItem";

type ChecklistRenderItem = {
  id: string;
  title: string;
  description?: string | null;
  statusLabel: string;
  statusTone: "required" | "reviewing" | "complete" | "inflight" | "optional";
  helper: {
    why: string;
    formats: string;
    examples: string;
    scans: string;
  };
  required: boolean;
  completedLabel?: string | null;
};

export function BorrowerChecklistSection({
  title,
  summary,
  items,
  emptyTitle,
  emptyMessage,
  collapsible,
}: {
  title: string;
  summary: string;
  items: ChecklistRenderItem[];
  emptyTitle: string;
  emptyMessage: string;
  collapsible?: boolean;
}) {
  if (items.length === 0) {
    return (
      <section className="rounded-[1.25rem] border border-stone-200 bg-stone-50/60 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
          {title}
        </h3>
        <p className="mt-2 text-sm text-stone-600">{summary}</p>
        <div className="mt-4">
          <BorrowerChecklistEmptyState title={emptyTitle} message={emptyMessage} />
        </div>
      </section>
    );
  }

  if (collapsible) {
    return (
      <details className="rounded-[1.25rem] border border-stone-200 bg-stone-50/60 p-4">
        <summary className="cursor-pointer list-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                {title}
              </h3>
              <p className="mt-2 text-sm text-stone-600">{summary}</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-stone-700">
              {items.length}
            </span>
          </div>
        </summary>
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <BorrowerChecklistItem key={item.id} {...item} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <section className="rounded-[1.25rem] border border-stone-200 bg-stone-50/60 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
        {title}
      </h3>
      <p className="mt-2 text-sm text-stone-600">{summary}</p>
      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <BorrowerChecklistItem key={item.id} {...item} />
        ))}
      </div>
    </section>
  );
}
