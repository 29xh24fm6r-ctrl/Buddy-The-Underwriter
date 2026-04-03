"use client";

type MemoStatus = "fresh" | "stale" | "missing" | "failed";

interface Props {
  dealId: string;
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
    label: "Not Generated",
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

const STATUS_EXPLANATION: Record<MemoStatus, string> = {
  fresh: "The credit memo reflects current financial data and pricing.",
  stale: "Financial data or pricing has changed since the memo was last generated.",
  missing: "No credit memo has been generated for this deal yet.",
  failed: "Memo generation encountered an error. Please retry.",
};

const CTA_LABELS: Record<MemoStatus, string> = {
  fresh: "",
  stale: "Regenerate Credit Memo",
  missing: "Generate Credit Memo",
  failed: "Retry Credit Memo Generation",
};

function humanizeReason(reason: string): string {
  if (reason.includes("No memo has been generated")) return "No memo exists yet.";
  if (reason.includes("Canonical state has changed")) return "Underlying data has changed since last generation.";
  if (reason.includes("No financial snapshot")) return "Financial snapshot must be built first.";
  return reason;
}

export default function MemoFreshnessCard({
  dealId,
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

  const ctaLabel = CTA_LABELS[status];

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4 space-y-2`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">Credit Memo</h4>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${cfg.pill}`}>
          {cfg.label}
        </span>
      </div>

      <p className="text-xs text-white/50">{STATUS_EXPLANATION[status]}</p>

      <div className="space-y-1 text-xs text-white/40">
        {formattedDate && <div>Last generated {formattedDate}</div>}
        {inputHash && <div className="font-mono text-white/30">Provenance: {inputHash.slice(0, 8)}</div>}
      </div>

      {staleReasons.length > 0 && (
        <ul className="space-y-0.5">
          {staleReasons.map((r, i) => (
            <li key={i} className="text-xs text-amber-300/80">{humanizeReason(r)}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        {ctaLabel && (
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15 disabled:opacity-50 flex-1"
          >
            {regenerating ? "Generating..." : ctaLabel}
          </button>
        )}
        {formattedDate && (
          <a
            href={`/credit-memo/${dealId}/canonical`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/5 text-center"
          >
            View Memo
          </a>
        )}
      </div>
    </div>
  );
}
