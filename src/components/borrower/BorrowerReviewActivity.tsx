"use client";

import { Icon } from "@/components/ui/Icon";

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
  kind: "upload" | "review" | "request" | "package";
};

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function kindIcon(kind: ActivityItem["kind"]) {
  if (kind === "upload") return "cloud_upload" as const;
  if (kind === "review") return "fact_check" as const;
  if (kind === "request") return "description" as const;
  return "auto_awesome" as const;
}

export function BorrowerReviewActivity({
  items,
}: {
  items: ActivityItem[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        Recent updates
      </div>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">
        What changed in your SBA package
      </h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Buddy only shows borrower-safe updates here. Internal review notes and lender routing are never shown in this portal.
      </p>
      <div className="mt-5 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-[1rem] border border-dashed border-stone-300 bg-stone-50/80 p-4 text-sm text-stone-600">
            Buddy will list package updates here as your documents are received and reviewed.
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex gap-3 rounded-[1rem] border border-stone-200 bg-stone-50/60 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white">
                <Icon name={kindIcon(item.kind)} className="h-4 w-4 text-stone-700" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-semibold text-stone-900">{item.title}</div>
                  <div className="shrink-0 text-xs text-stone-500">{timeAgo(item.createdAt)}</div>
                </div>
                <p className="mt-1 text-sm leading-6 text-stone-600">{item.detail}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
