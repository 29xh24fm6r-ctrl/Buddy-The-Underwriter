"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerDocumentGroup } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import { BorrowerDocumentRequirementCard } from "./BorrowerDocumentRequirementCard";

import type { IconName } from "@/components/ui/Icon";

const GROUP_ICONS: Record<BorrowerDocumentGroup["id"], IconName> = {
  business_financials: "analytics",
  tax_returns: "description",
  sba_forms: "fact_check",
  ownership_identity: "person",
  business_documents: "account_balance",
  supporting_documents: "file",
};

export function BorrowerDocumentGroupCard({
  group,
}: {
  group: BorrowerDocumentGroup;
}) {
  const icon = GROUP_ICONS[group.id] ?? "file";
  const completion =
    group.requiredCount > 0
      ? `${group.receivedCount} of ${group.requiredCount} required received`
      : `${group.receivedCount} item${group.receivedCount === 1 ? "" : "s"} received`;
  const hasAttention = group.needsAttentionCount > 0;

  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100">
            <Icon name={icon} className="h-5 w-5 text-stone-700" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-900 sm:text-base">
              {group.label}
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-stone-600 sm:text-sm">
              {group.description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-medium text-stone-700">
            {completion}
          </span>
          {hasAttention && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
              {group.needsAttentionCount} need
              {group.needsAttentionCount === 1 ? "s" : ""} attention
            </span>
          )}
        </div>
      </header>

      <div className="mt-4 space-y-3">
        {group.requirements.map((requirement) => (
          <BorrowerDocumentRequirementCard
            key={requirement.id}
            requirement={requirement}
          />
        ))}
      </div>
    </section>
  );
}
