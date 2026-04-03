"use client";

type MemoStatus = "fresh" | "stale" | "missing" | "failed";

interface Props {
  status: MemoStatus;
  staleReasons: string[];
  lastGeneratedAt: string | null;
  inputHash: string | null;
  onRegenerate: () => void;
  regenerating?: boolean;
}

const STATUS_CONFIG: Record<MemoStatus, { label: string; pill: string; border: string; bg: string }> = {
  fresh: {
    label: "Fresh",
    pill: "bg-emerald-500/20 text-emerald-300",
    border: "border-emerald-500/20",
    bg: "bg-emerald-500/5",
  },
  stale: {
    label: "Stale",
    pill: "bg-amber-500/20 text-amber-300",
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
  },
  missing: {
    label: "Missing",
    pill: "bg-white/10 text-white/50",
    border: "border-white/10",
    bg: "bg-white/[0.02]",
  },
  failed: {
    label: "Error",
    pill: "bg-red-500/20 text-red-300",
    border: "border-red-500/20",
    bg: "bg-red-500/5",
  },
};

export default function MemoFreshnessCard({
  status,
  staleReasons,
  lastGeneratedAt,
  inputHash,
  onRegenerate,
  regenerating,
}: Props) {
  const cfg = STATUS_CONFIG[status];

  const formattedDate = lastGeneratedAt
    ? new Date(lastGeneratedAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4 space-y-2`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">Credit Memo</h4>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${cfg.pill}`}>
          {cfg.label}
        </span>
      </div>

      <div className="space-y-1 text-xs text-white/50">
        {formattedDate && <div>Generated {formattedDate}</div>}
        {inputHash && <div className="font-mono text-white/30">Hash: {inputHash.slice(0, 8)}</div>}
      </div>

      {staleReasons.length > 0 && (
        <ul className="space-y-0.5">
          {staleReasons.map((r, i) => (
            <li key={i} className="text-xs text-amber-300/80">{r}</li>
          ))}
        </ul>
      )}

      {(status === "stale" || status === "missing") && (
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15 disabled:opacity-50 w-full"
        >
          {regenerating ? "Regenerating..." : "Regenerate Memo"}
        </button>
      )}
    </div>
  );
}
