"use client";

import { Icon } from "@/components/ui/Icon";
import type {
  BorrowerSubmissionPackageItem,
  BorrowerSubmissionPackageItemCategory,
} from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";

const CATEGORY_LABELS: Record<BorrowerSubmissionPackageItemCategory, string> = {
  financial: "Financial documents",
  forms: "SBA forms",
  identity: "Identity documents",
  ownership: "Ownership documents",
  business_documents: "Business documents",
  supporting: "Supporting documents",
};

export function BorrowerSubmissionPackageSummary({
  items,
}: {
  items: BorrowerSubmissionPackageItem[];
}) {
  if (items.length === 0) return null;

  // Group by category
  const grouped = new Map<BorrowerSubmissionPackageItemCategory, BorrowerSubmissionPackageItem[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  return (
    <section className="rounded-[1.5rem] border border-emerald-200/60 bg-emerald-50/30 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/80">
          <Icon name="check_circle" className="h-4 w-4 text-emerald-600" />
        </div>
        <h3 className="text-sm font-semibold text-emerald-900">
          Included in your package
        </h3>
      </div>

      <div className="mt-4 space-y-3">
        {Array.from(grouped.entries()).map(([cat, catItems]) => (
          <div key={cat}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {CATEGORY_LABELS[cat]}
            </div>
            <ul className="mt-1 space-y-1">
              {catItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 text-sm text-slate-800"
                >
                  <span className="h-1 w-1 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
