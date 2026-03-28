"use client";

/**
 * Phase 65I — Monitoring Cycles Table
 */

type Cycle = {
  id: string;
  obligationId: string;
  title: string;
  dueAt: string;
  status: string;
  severity: string;
  blockingParty: string;
  borrowerCampaignId: string | null;
};

type Props = {
  cycles: Cycle[];
  onStartReview: (cycleId: string) => void;
  onComplete: (cycleId: string) => void;
  loading: boolean;
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  urgent: "bg-amber-500/20 text-amber-400",
  watch: "bg-yellow-500/15 text-yellow-400",
  healthy: "bg-emerald-500/15 text-emerald-400",
};

const STATUS_LABELS: Record<string, string> = {
  upcoming: "Upcoming",
  due: "Due",
  overdue: "Overdue",
  submitted: "Submitted",
  under_review: "Under Review",
  completed: "Completed",
  waived: "Waived",
  exception_open: "Exception",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MonitoringCyclesTable({
  cycles,
  onStartReview,
  onComplete,
  loading,
}: Props) {
  if (cycles.length === 0) {
    return (
      <div className="text-center text-white/30 py-6 text-sm">
        No monitoring cycles generated yet.
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <table className="w-full">
        <thead className="glass-header">
          <tr>
            <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase">Obligation</th>
            <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-24">Due</th>
            <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-20">Severity</th>
            <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-20">Blocking</th>
            <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-24">Status</th>
            <th className="px-4 py-2 text-right text-[11px] font-semibold text-white/70 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {cycles.map((c) => (
            <tr key={c.id} className="glass-row">
              <td className="px-4 py-2 text-xs text-white/70">{c.title}</td>
              <td className="px-4 py-2 text-xs text-white/50">{formatDate(c.dueAt)}</td>
              <td className="px-4 py-2">
                <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${SEVERITY_STYLES[c.severity] ?? ""}`}>
                  {c.severity}
                </span>
              </td>
              <td className="px-4 py-2 text-xs text-white/50 capitalize">{c.blockingParty}</td>
              <td className="px-4 py-2 text-xs text-white/60">{STATUS_LABELS[c.status] ?? c.status}</td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  {c.status === "submitted" && (
                    <button
                      onClick={() => onStartReview(c.id)}
                      disabled={loading}
                      className="px-2 py-1 text-[11px] rounded bg-blue-600/80 text-white hover:bg-blue-500 transition disabled:opacity-50"
                    >
                      Start Review
                    </button>
                  )}
                  {(c.status === "under_review" || c.status === "submitted") && (
                    <button
                      onClick={() => onComplete(c.id)}
                      disabled={loading}
                      className="px-2 py-1 text-[11px] rounded bg-emerald-600/80 text-white hover:bg-emerald-500 transition disabled:opacity-50"
                    >
                      Complete
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
