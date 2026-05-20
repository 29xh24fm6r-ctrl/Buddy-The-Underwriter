"use client";

import { Icon } from "@/components/ui/Icon";
import type { TeamWorkloadItem } from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

const ROLE_LABEL: Record<TeamWorkloadItem["role"], string> = {
  banker: "Banker",
  processor: "Processor",
  admin: "Admin",
};

export function BrokerageTeamWorkloadTable({
  workload,
}: {
  workload: TeamWorkloadItem[];
}) {
  return (
    <section
      role="region"
      aria-label="Team workload"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="person" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Team workload</h3>
        <span className="ml-auto inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
          {workload.length}
        </span>
      </header>

      {workload.length === 0 ? (
        <p className="mt-3 text-sm italic text-white/60">
          Team workload will appear once deals are assigned to team members.
        </p>
      ) : (
        <ul
          className="mt-4 space-y-2"
          role="list"
          aria-label="Team workload entries"
        >
          {workload.map((member) => (
            <li
              key={member.id}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:p-4"
              aria-label={`Workload for ${member.name}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">
                  {member.name}
                </span>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider text-white/40"
                  aria-label={`Role ${ROLE_LABEL[member.role]}`}
                >
                  {ROLE_LABEL[member.role]}
                </span>
                <span className="ml-auto text-[11px] font-semibold text-white">
                  {member.activeDeals} active
                </span>
              </div>

              <dl
                className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
                aria-label="Workload counts"
              >
                <Stat label="Banker action" value={member.bankerActionRequired} />
                <Stat label="Clarifications" value={member.clarificationWorkload} />
                <Stat label="Stalled" value={member.stalledDeals} />
                <Stat label="Recent activity" value={member.recentActivityCount} />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </dt>
      <dd className="mt-0.5 text-base font-semibold text-white">{value}</dd>
    </div>
  );
}
