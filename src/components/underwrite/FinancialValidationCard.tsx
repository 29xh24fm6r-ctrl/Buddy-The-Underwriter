"use client";

interface Props {
  dealId: string;
  memoSafe: boolean;
  decisionSafe: boolean;
  blockers: string[];
  warnings: string[];
  snapshotId: string | null;
}

function deriveExplanation(memoSafe: boolean, decisionSafe: boolean, blockers: string[], warnings: string[]): string {
  if (decisionSafe && memoSafe) return "All financial data is validated and ready for committee decision.";
  if (memoSafe && !decisionSafe) return "Financial data is sufficient for memo preparation, but needs further validation before a committee decision.";
  if (blockers.length > 0) return "Critical financial data issues must be resolved before proceeding.";
  if (warnings.length > 0) return "Financial data has items that need banker attention.";
  return "Financial validation status could not be determined.";
}

export default function FinancialValidationCard({
  dealId,
  memoSafe,
  decisionSafe,
  blockers,
  warnings,
  snapshotId,
}: Props) {
  // Derive border/bg from worst state
  let border: string;
  let bg: string;
  if (blockers.length > 0) {
    border = "border-red-500/20";
    bg = "bg-red-500/5";
  } else if (warnings.length > 0 || !decisionSafe) {
    border = "border-amber-500/30";
    bg = "bg-amber-500/5";
  } else {
    border = "border-emerald-500/20";
    bg = "bg-emerald-500/5";
  }

  const explanation = deriveExplanation(memoSafe, decisionSafe, blockers, warnings);

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

      <p className="text-xs text-white/50">{explanation}</p>

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

      <a
        href={`/deals/${dealId}/financial-validation`}
        className="block rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15 w-full text-center"
      >
        {blockers.length > 0 ? "Review & Resolve Issues" : "View Financial Validation"}
      </a>
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
