"use client";

type PacketStatus = "ready" | "warning" | "blocked" | "missing";

interface Props {
  status: PacketStatus;
  warnings: string[];
  blockers: string[];
  lastGeneratedAt: string | null;
  financialValidationStatus: string | null;
  hasCanonicalMemoNarrative: boolean;
  onGeneratePacket: () => void;
  generating?: boolean;
}

const STATUS_CONFIG: Record<PacketStatus, { label: string; pill: string; border: string; bg: string }> = {
  ready: {
    label: "Ready",
    pill: "bg-emerald-500/20 text-emerald-300",
    border: "border-emerald-500/20",
    bg: "bg-emerald-500/5",
  },
  warning: {
    label: "Warning",
    pill: "bg-amber-500/20 text-amber-300",
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
  },
  blocked: {
    label: "Blocked",
    pill: "bg-red-500/20 text-red-300",
    border: "border-red-500/20",
    bg: "bg-red-500/5",
  },
  missing: {
    label: "Not Generated",
    pill: "bg-white/10 text-white/50",
    border: "border-white/10",
    bg: "bg-white/[0.02]",
  },
};

export default function PacketReadinessCard({
  status,
  warnings,
  blockers,
  lastGeneratedAt,
  financialValidationStatus,
  hasCanonicalMemoNarrative,
  onGeneratePacket,
  generating,
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
        <h4 className="text-sm font-semibold text-white">Committee Packet</h4>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${cfg.pill}`}>
          {cfg.label}
        </span>
      </div>

      <div className="space-y-1 text-xs text-white/50">
        {formattedDate && <div>Last generated {formattedDate}</div>}
        {financialValidationStatus && (
          <div>Financial validation: {financialValidationStatus.replace(/_/g, " ")}</div>
        )}
        <div>
          Memo narrative: {hasCanonicalMemoNarrative ? "present" : "missing"}
        </div>
      </div>

      {blockers.length > 0 && (
        <ul className="space-y-0.5">
          {blockers.map((b, i) => (
            <li key={i} className="text-xs text-red-300/80">{b}</li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-xs text-amber-300/80">{w}</li>
          ))}
        </ul>
      )}

      {status !== "blocked" && (
        <button
          onClick={onGeneratePacket}
          disabled={generating}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15 disabled:opacity-50 w-full"
        >
          {generating ? "Generating..." : status === "missing" ? "Generate Packet" : "Regenerate Packet"}
        </button>
      )}
    </div>
  );
}
