"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerMobileCommandViewModel } from "@/lib/borrower/buildBorrowerMobileCommandViewModel";

function buildShortLabel(vm: BorrowerMobileCommandViewModel): string {
  switch (vm.state) {
    case "blocked":
      return "Blocking item needs attention";
    case "action_needed": {
      const count = vm.priorityItems.length;
      if (count === 0) return "Items need your attention";
      return `${count} item${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention`;
    }
    case "waiting":
      return "Buddy is reviewing your package";
    case "in_progress":
      return "Package moving forward";
    case "no_action_needed":
      return "No action needed";
  }
}

export function BorrowerMobileNextActionBar({
  viewModel,
}: {
  viewModel: BorrowerMobileCommandViewModel;
}) {
  const hasCta = Boolean(viewModel.primaryCtaLabel && viewModel.primaryCtaHref);
  const shortLabel = buildShortLabel(viewModel);

  return (
    <div
      role="region"
      aria-label="Next action"
      className="flex items-center justify-between gap-3"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
          Next action
        </div>
        <div
          className={cn(
            "mt-0.5 truncate text-sm font-semibold",
            viewModel.state === "blocked" ? "text-rose-900" : "text-stone-900",
          )}
        >
          {shortLabel}
        </div>
      </div>

      {hasCta ? (
        <a
          href={viewModel.primaryCtaHref}
          aria-label={viewModel.primaryCtaLabel}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-stone-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          <Icon name="cloud_upload" className="h-4 w-4 text-current" />
          {viewModel.primaryCtaLabel}
        </a>
      ) : (
        <span
          aria-label="No action required"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-500"
        >
          <Icon name="check_circle" className="h-4 w-4 text-emerald-600" />
          All caught up
        </span>
      )}
    </div>
  );
}
