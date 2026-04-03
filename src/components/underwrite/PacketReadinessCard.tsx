"use client";

type PacketStatus = "ready" | "warning" | "blocked" | "missing";

interface Props {
  dealId: string;
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
    label: "Needs Attention",
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

const STATUS_EXPLANATION: Record<PacketStatus, string> = {
  ready: "All preflight checks pass. Packet can be generated for committee.",
  warning: "Packet can be generated as a draft, but some items need attention.",
  blocked: "Cannot generate packet until blocking issues are resolved.",
  missing: "No committee packet has been generated yet.",
};

function humanizeBlocker(blocker: string): string {
  if (blocker.includes("not decision-safe")) return "Financial validation must be decision-safe before generating a final packet.";
  if (blocker.includes("snapshot is stale")) return "Financial snapshot is stale and needs to be rebuilt first.";
  if (blocker.includes("not memo-safe")) return "Financial data is insufficient for even a draft packet.";
  if (blocker.includes("Could not compute")) return "Unable to check packet readiness. Try refreshing.";
  return blocker;
}

function humanizeWarning(warning: string): string {
  if (warning.includes("DRAFT packet")) return "This will be a draft — financial validation is not yet decision-safe.";
  if (warning.includes("unresolved financial conflict")) return warning;
  if (warning.includes("low-confidence follow-up")) return warning;
  return warning;
}

export default function PacketReadinessCard({
  dealId,
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

  // CTA logic: state-aware labels
  let ctaLabel: string | null = null;
  let ctaDisabled = false;
  if (status === "blocked") {
    ctaLabel = "Resolve Issues First";
    ctaDisabled = true;
  } else if (status === "missing" || (!formattedDate && status === "ready")) {
    ctaLabel = "Generate Committee Packet";
  } else if (status === "warning") {
    ctaLabel = "Generate Draft Packet";
  } else {
    ctaLabel = "Regenerate Packet";
  }

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4 space-y-2`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">Committee Packet</h4>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${cfg.pill}`}>
          {cfg.label}
        </span>
      </div>

      <p className="text-xs text-white/50">{STATUS_EXPLANATION[status]}</p>

      <div className="space-y-1 text-xs text-white/40">
        {formattedDate && <div>Last generated {formattedDate}</div>}
        {financialValidationStatus && (
          <div>Financials: {financialValidationStatus.replace(/_/g, " ")}</div>
        )}
        <div>
          Memo narrative: {hasCanonicalMemoNarrative
            ? <span className="text-emerald-300/60">present</span>
            : <span className="text-amber-300/60">missing — generate memo first</span>}
        </div>
      </div>

      {blockers.length > 0 && (
        <ul className="space-y-0.5">
          {blockers.map((b, i) => (
            <li key={i} className="text-xs text-red-300/80">{humanizeBlocker(b)}</li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-xs text-amber-300/80">{humanizeWarning(w)}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          onClick={onGeneratePacket}
          disabled={generating || ctaDisabled}
          className={`rounded-lg px-3 py-1.5 text-xs flex-1 ${
            ctaDisabled
              ? "bg-white/5 text-white/30 cursor-not-allowed"
              : "bg-white/10 text-white hover:bg-white/15 disabled:opacity-50"
          }`}
        >
          {generating ? "Generating..." : ctaLabel}
        </button>
        {status === "blocked" && (
          <a
            href={`/deals/${dealId}/financial-validation`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/5 text-center"
          >
            Fix Issues
          </a>
        )}
      </div>
    </div>
  );
}
