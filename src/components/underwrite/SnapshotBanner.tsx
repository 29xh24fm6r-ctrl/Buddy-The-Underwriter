"use client";

interface Props {
  snapshotId: string;
  launchSequence: number;
  launchedAt: string;
  launchedBy: string;
  handoffNote?: string | null;
  canonicalLoanRequestId?: string | null;
  financialSnapshotId?: string | null;
}

export default function SnapshotBanner({
  snapshotId,
  launchSequence,
  launchedAt,
  launchedBy,
  handoffNote,
  financialSnapshotId,
}: Props) {
  const launchDate = new Date(launchedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-300">
            Snapshot {launchSequence}
          </span>
          <span className="text-sm text-white/70">
            Launched {launchDate}
          </span>
          <span className="text-xs text-white/40">
            by {launchedBy.slice(0, 8)}
          </span>
        </div>
        {financialSnapshotId && (
          <span className="text-xs text-white/40">
            Financial: {financialSnapshotId.slice(0, 8)}
          </span>
        )}
      </div>
      {handoffNote && (
        <p className="mt-1 text-xs text-white/50 italic">
          {handoffNote}
        </p>
      )}
    </div>
  );
}
