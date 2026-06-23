"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerDocumentExperienceViewModel } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import { BorrowerDocumentPackageSummary } from "./BorrowerDocumentPackageSummary";
import { BorrowerDocumentGroupCard } from "./BorrowerDocumentGroupCard";
import { BorrowerDocumentAttentionCard } from "./BorrowerDocumentAttentionCard";

export function BorrowerDocumentExperience({
  viewModel,
}: {
  viewModel: BorrowerDocumentExperienceViewModel;
}) {
  const hasGroups = viewModel.groups.length > 0;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[1.75rem] border border-stone-200 bg-[linear-gradient(135deg,_rgba(248,250,252,0.8)_0%,_rgba(241,245,249,0.4)_100%)] p-5 sm:p-7">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white shadow-sm">
            <Icon name="cloud_upload" className="h-5 w-5 text-stone-700" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
            Your documents
          </span>
        </div>

        <div className="mt-4 space-y-2">
          <h2 className="font-serif text-2xl leading-tight text-stone-950 sm:text-3xl">
            Everything Buddy is collecting for your SBA package.
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-stone-700 sm:text-base">
            Each item below shows what to upload, why it matters, what a good
            upload looks like, and whether Buddy has received it. You can upload
            from your phone or computer.
          </p>
        </div>
      </section>

      <BorrowerDocumentPackageSummary summary={viewModel.packageSummary} />

      {viewModel.primaryAttentionItems.length > 0 && (
        <BorrowerDocumentAttentionCard
          items={viewModel.primaryAttentionItems}
        />
      )}

      {hasGroups ? (
        <div className="space-y-4">
          {viewModel.groups.map((group) => (
            <BorrowerDocumentGroupCard key={group.id} group={group} />
          ))}
        </div>
      ) : (
        <section className="rounded-[1.5rem] border border-stone-200 bg-white p-6 text-center">
          <p className="text-sm text-stone-600">
            Buddy will list requested documents here as soon as they are ready.
          </p>
        </section>
      )}
    </div>
  );
}
