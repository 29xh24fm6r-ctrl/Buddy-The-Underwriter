"use client";

interface Props {
  title: string;
  status: string;
  snapshotId: string;
  snapshotLabel: string;
  isStale: boolean;
  primaryCta: string;
  onPrimaryAction: () => void;
  children?: React.ReactNode;
}

const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  not_started: { bg: "bg-white/10 text-white/50", label: "Not Started" },
  in_progress: { bg: "bg-blue-500/20 text-blue-300", label: "In Progress" },
  needs_refresh: { bg: "bg-amber-500/20 text-amber-300", label: "Needs Refresh" },
  completed: { bg: "bg-emerald-500/20 text-emerald-300", label: "Completed" },
};

export default function WorkstreamCard({
  title,
  status,
  snapshotId,
  snapshotLabel,
  isStale,
  primaryCta,
  onPrimaryAction,
  children,
}: Props) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.not_started;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="flex items-center gap-2">
          {isStale && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
              Stale
            </span>
          )}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${style.bg}`}>
            {style.label}
          </span>
        </div>
      </div>

      <div className="text-xs text-white/40">
        Seeded from {snapshotLabel}
      </div>

      {children && <div className="text-sm text-white/70">{children}</div>}

      <button
        onClick={onPrimaryAction}
        className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 w-full"
      >
        {primaryCta}
      </button>
    </div>
  );
}
