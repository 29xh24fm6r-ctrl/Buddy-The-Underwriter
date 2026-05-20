"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BankerDealWorkspaceHeader as HeaderVm } from "@/lib/banker/buildDealIntelligenceWorkspace";

export function BankerDealWorkspaceHeader({
  header,
}: {
  header: HeaderVm;
}) {
  return (
    <section
      role="region"
      aria-label="Deal workspace header"
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6"
    >
      <header>
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Banker deal workspace
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          {header.dealLabel}
        </h1>
        {header.borrowerLabel && header.borrowerLabel !== header.dealLabel && (
          <p className="mt-1 text-sm text-white/60">{header.borrowerLabel}</p>
        )}
      </header>

      <dl
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Deal state summary"
      >
        <SummaryStat label="Operational state" value={header.operationalStateLabel} />
        <SummaryStat label="Submission readiness" value={header.submissionReadinessLabel} />
        <SummaryStat label="Routing readiness" value={header.routingReadinessLabel} />
        <SummaryStat label="Waiting on" value={header.waitingOnLabel} />
      </dl>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
            Banker next action
          </div>
          <div
            className={cn(
              "mt-1 text-base font-semibold",
              header.nextActionHref ? "text-white" : "text-white/80",
            )}
          >
            {header.nextActionLabel}
          </div>
          {header.recentActivitySummary && (
            <p className="mt-1 text-xs text-white/60">{header.recentActivitySummary}</p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
          <div
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
            aria-label="Unresolved issues"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
              Unresolved
            </span>
            <span className="text-base font-semibold text-white">
              {header.unresolvedIssueCount}
            </span>
          </div>
          {header.nextActionHref && (
            <a
              href={header.nextActionHref}
              aria-label={header.nextActionLabel}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-stone-900 transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
            >
              <Icon name="arrow_forward_ios" className="h-3 w-3 text-current" />
              Open next action
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-white">{value}</dd>
    </div>
  );
}
