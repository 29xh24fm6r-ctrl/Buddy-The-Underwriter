"use client";

/**
 * Phase 65I — Monitoring Exceptions Panel
 */

type Exception = {
  id: string;
  exceptionCode: string;
  severity: string;
  status: string;
  openedAt: string;
};

type Props = {
  exceptions: Exception[];
  onResolve: (exceptionId: string) => void;
  loading: boolean;
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "text-red-400",
  urgent: "text-amber-400",
  watch: "text-yellow-400",
};

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "<1d";
  return `${days}d`;
}

export default function MonitoringExceptionsPanel({
  exceptions,
  onResolve,
  loading,
}: Props) {
  if (exceptions.length === 0) return null;

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <h4 className="text-xs font-semibold text-white/70 uppercase">
        Open Exceptions ({exceptions.length})
      </h4>
      <div className="space-y-2">
        {exceptions.map((ex) => (
          <div
            key={ex.id}
            className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${SEVERITY_STYLES[ex.severity] ?? "text-white/50"}`}>
                {ex.severity.toUpperCase()}
              </span>
              <span className="text-xs text-white/60">
                {ex.exceptionCode.replace(/_/g, " ")}
              </span>
              <span className="text-[10px] text-white/30">{formatAge(ex.openedAt)} ago</span>
            </div>
            <button
              onClick={() => onResolve(ex.id)}
              disabled={loading}
              className="px-2 py-0.5 text-[11px] rounded bg-white/5 border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10 transition disabled:opacity-50"
            >
              Resolve
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
