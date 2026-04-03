"use client";

interface Props {
  memoSafe: boolean;
  decisionSafe: boolean;
  blockers: string[];
  warnings: string[];
  snapshotId: string | null;
  onViewProvenance: () => void;
}

export default function FinancialValidationCard({
  memoSafe,
  decisionSafe,
  blockers,
  warnings,
  snapshotId,
  onViewProvenance,
}: Props) {
  const hasIssues = blockers.length > 0 || warnings.length > 0;

  // Derive border/bg from worst state
  let border: string;
  let bg: string;
  if (blockers.length > 0) {
    border = "border-red-500/20";
    bg = "bg-red-500/5";
  } else if (warnings.length > 0) {
    border = "border-amber-500/30";
    bg = "bg-amber-500/5";
  } else {
    border = "border-emerald-500/20";
    bg = "bg-emerald-500/5";
  }

  return (
    <div className={`rounded-xl border ${border} ${bg} p-4 space-y-2`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">Financial Validation</h4>
        {snapshotId && (
          <span className="text-[10px] font-mono text-white/30">
            {snapshotId.slice(0, 8)}
          </span>
        )}
      </div>

      <div className="flex gap-3 text-xs">
        <SafetyPill label="Memo-safe" ok={memoSafe} />
        <SafetyPill label="Decision-safe" ok={decisionSafe} />
      </div>

      {hasIssues && (
        <div className="space-y-1 text-xs">
          {blockers.length > 0 && (
            <div className="text-red-300/80">
              {blockers.length} blocker{blockers.length !== 1 ? "s" : ""}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="text-amber-300/80">
              {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {blockers.length > 0 && (
        <ul className="space-y-0.5">
          {blockers.map((b, i) => (
            <li key={i} className="text-xs text-red-300/80">{b}</li>
          ))}
        </ul>
      )}

      <button
        onClick={onViewProvenance}
        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15 w-full"
      >
        View Provenance
      </button>
    </div>
  );
}

function SafetyPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`rounded px-2 py-0.5 font-medium ${
        ok
          ? "bg-emerald-500/20 text-emerald-300"
          : "bg-red-500/20 text-red-300"
      }`}
    >
      {label}: {ok ? "Yes" : "No"}
    </span>
  );
}
