"use client";

/**
 * Phase 65I — Post-Close Program Summary Panel
 */

import type { MonitoringProgramSummary } from "@/core/post-close/types";

type Props = {
  program: MonitoringProgramSummary | null;
  annualReview: { status: string; dueAt: string | null } | null;
  renewalPrep: { status: string; prepStartAt: string | null } | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PostCloseProgramPanel({
  program,
  annualReview,
  renewalPrep,
}: Props) {
  if (!program) {
    return (
      <div className="glass-card rounded-xl p-6 text-center text-white/40">
        No monitoring program active for this deal.
      </div>
    );
  }

  const metrics = [
    { label: "Overdue", value: program.overdueCount, tone: program.overdueCount > 0 ? "text-red-400" : "text-white/60" },
    { label: "Due Now", value: program.dueCount, tone: program.dueCount > 0 ? "text-amber-400" : "text-white/60" },
    { label: "Upcoming", value: program.upcomingCount, tone: "text-white/60" },
    { label: "Under Review", value: program.underReviewCount, tone: program.underReviewCount > 0 ? "text-blue-400" : "text-white/60" },
    { label: "Exceptions", value: program.openExceptionCount, tone: program.openExceptionCount > 0 ? "text-red-400" : "text-white/60" },
  ];

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/90">
          Post-Close Monitoring
        </h3>
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">
          {program.programStatus}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="text-center">
            <p className={`text-xl font-bold ${m.tone}`}>{m.value}</p>
            <p className="text-[10px] text-white/40 uppercase">{m.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-white/5 pt-3">
        <div>
          <p className="text-[10px] text-white/40 uppercase">Next Reporting</p>
          <p className="text-xs text-white/70">{formatDate(program.nextReportingDueAt)}</p>
        </div>
        <div>
          <p className="text-[10px] text-white/40 uppercase">Annual Review</p>
          <p className="text-xs text-white/70">
            {annualReview ? `${annualReview.status} — ${formatDate(annualReview.dueAt)}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-white/40 uppercase">Renewal Prep</p>
          <p className="text-xs text-white/70">
            {renewalPrep ? `${renewalPrep.status} — ${formatDate(renewalPrep.prepStartAt)}` : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
